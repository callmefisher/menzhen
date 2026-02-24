package main

import (
	"log"

	"github.com/callmefisher/menzhen/server/config"
)

func main() {
	cfg := config.Load()
	log.Printf("Starting server on port %s", cfg.ServerPort)
}
