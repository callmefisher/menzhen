package main

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

			// Retry loop: up to maxRetries, every 5 min
			retryTicker := time.NewTicker(5 * time.Minute)
			defer retryTicker.Stop()
			for range retryTicker.C {
				if len(failed) == 0 || retries >= maxRetries {
					break
				}
				retries++
				run()
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

	// Start server
	log.Printf("Server starting on port %s", cfg.ServerPort)
	if err := r.Run(":" + cfg.ServerPort); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
