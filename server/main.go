package main // build-test: 2026-04-07 — 验证一键更新是否重建镜像6

import (
	"log"
	"time"

	"github.com/callmefisher/menzhen/server/config"
	"github.com/callmefisher/menzhen/server/database"
	"github.com/callmefisher/menzhen/server/router"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/storage"
)

func main() {
	// Force Asia/Shanghai timezone for all time.Now() calls (appointment enqueue date checks).
	// The container TZ env var is the primary mechanism; this is a belt-and-suspenders fallback.
	if loc, err := time.LoadLocation("Asia/Shanghai"); err == nil {
		time.Local = loc
	} else {
		log.Printf("WARNING: failed to load Asia/Shanghai timezone: %v — time.Now() will use UTC", err)
	}

	cfg := config.Load()

	// Database
	db := database.InitDB(cfg)
	database.Seed(db)

	// MinIO
	minioClient := storage.InitMinIO(cfg)

	// Router
	r := router.SetupRouter(db, minioClient, cfg)

	// Prescription notification cleanup: delete records older than 24h, runs every hour
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			svc := service.NewPrescriptionNotificationService(db)
			if deleted, err := svc.Cleanup(); err != nil {
				log.Printf("prescription notification cleanup error: %v", err)
			} else if deleted > 0 {
				log.Printf("prescription notification cleanup: deleted %d records", deleted)
			}
		}
	}()

	// Queue cross-day cleanup: delete previous-day entries, runs every hour
	go func() {
		svc := service.NewQueueService(db)
		if deleted, err := svc.CrossDayCleanup(); err != nil {
			log.Printf("queue cleanup error: %v", err)
		} else if deleted > 0 {
			log.Printf("queue cleanup: deleted %d old entries", deleted)
		}
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			if deleted, err := svc.CrossDayCleanup(); err != nil {
				log.Printf("queue cleanup error: %v", err)
			} else if deleted > 0 {
				log.Printf("queue cleanup: deleted %d old entries", deleted)
			}
		}
	}()

	// Appointment auto-enqueue: runs at midnight, retries every 5 min if any failed.
	go func() {
		apptSvc := service.NewAppointmentService(db)
		queueSvc := service.NewQueueService(db)

		// scheduleAutoEnqueue fires once and retries failures up to maxRetries times.
		scheduleAutoEnqueue := func() {
			const maxRetries = 3
			retries := 0
			var failed []uint

			// Mark no_show for past-date unattended appointments before enqueuing today's
			if affected, err := apptSvc.MarkNoShowAllTenantsForPastDates(); err != nil {
				log.Printf("appointment no_show marking failed: %v", err)
			} else if affected > 0 {
				log.Printf("appointment no_show: marked %d appointments", affected)
			}

			run := func() {
				f, n := apptSvc.AutoEnqueueToday(queueSvc)
				if n > 0 {
					log.Printf("appointment auto-enqueue: queued %d entries", n)
				}
				if len(f) > 0 {
					log.Printf("appointment auto-enqueue: %d entries failed, will retry (attempt %d/%d)", len(f), retries+1, maxRetries)
				}
				failed = f
			}
			run()

			// Retry loop: up to maxRetries, every 5 min (only if there are failures)
			if len(failed) > 0 {
				retryTicker := time.NewTicker(5 * time.Minute)
				defer retryTicker.Stop()
				for range retryTicker.C {
					if len(failed) == 0 || retries >= maxRetries {
						retryTicker.Stop()
						break
					}
					retries++
					run()
				}
			}
			if len(failed) > 0 {
				log.Printf("appointment auto-enqueue: gave up after %d retries, failed IDs: %v", maxRetries, failed)
			}
		}

		// Run once on startup (catches any missed midnight job from crash/restart)
		scheduleAutoEnqueue()

		// Then run at each subsequent midnight
		for {
			now := time.Now()
			next := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 5, 0, now.Location())
			time.Sleep(time.Until(next))
			scheduleAutoEnqueue()
		}
	}()

	// Daily database cleanup: runs immediately on startup (then every 24h as backup).
	// Designed for servers that may run only ~1 hour/day at an arbitrary time.
	// Retry logic: up to 3 attempts with 5-min intervals on failure.
	go func() {
		runCleanup := func() {
			const maxRetries = 3
			for attempt := 1; attempt <= maxRetries; attempt++ {
				cleanupSvc := service.NewDBCleanupService(db)
				result, err := cleanupSvc.CleanupOrphanData()
				if err == nil {
					log.Printf("[db-cleanup] done: %+v", result.Cleaned)
					return
				}
				log.Printf("[db-cleanup] attempt %d/%d failed: %v", attempt, maxRetries, err)
				if attempt < maxRetries {
					time.Sleep(5 * time.Minute)
				}
			}
			log.Printf("[db-cleanup] all retries exhausted, will retry on next startup or 24h tick")
		}

		// Run immediately on startup — covers any-time boot scenario
		runCleanup()

		// Also run every 24h in case the server stays up continuously
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			runCleanup()
		}
	}()

	// License: ensure machine-id on startup
	machineID := service.EnsureMachineID()
	log.Printf("Machine ID: %s", machineID)

	// License expiry check: runs every 1 minute
	go func() {
		service.CheckExpiredLicenses(db)
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			service.CheckExpiredLicenses(db)
		}
	}()

	// Start server
	log.Printf("Server starting on port %s", cfg.ServerPort)
	if err := r.Run(":" + cfg.ServerPort); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
