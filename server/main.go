package main

import (
	"log"

	"github.com/callmefisher/menzhen/server/config"
	"github.com/callmefisher/menzhen/server/database"
)

func main() {
	cfg := config.Load()
	db := database.InitDB(cfg)
	database.Seed(db)
	log.Printf("Starting server on port %s", cfg.ServerPort)
}
