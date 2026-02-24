package main

import (
	"log"

	"github.com/callmefisher/menzhen/server/config"
	"github.com/callmefisher/menzhen/server/database"
	"github.com/callmefisher/menzhen/server/router"
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

	// Start server
	log.Printf("Server starting on port %s", cfg.ServerPort)
	if err := r.Run(":" + cfg.ServerPort); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
