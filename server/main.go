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

	// Start server
	log.Printf("Server starting on port %s", cfg.ServerPort)
	if err := r.Run(":" + cfg.ServerPort); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
