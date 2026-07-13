package main

import (
	"context"
	"log"
	"os"

	"github.com/accensa/accensa-app/indexer/api"
	"github.com/accensa/accensa-app/indexer/db"
	"github.com/accensa/accensa-app/indexer/stellar"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}

	ctx := context.Background()
	database, err := db.Connect(ctx, dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to db: %v", err)
	}
	defer database.Close()

	if err := database.InitSchema(ctx); err != nil {
		log.Fatalf("Failed to init schema: %v", err)
	}

	// Start the Stellar RPC poller in the background
	rpcURL := os.Getenv("STELLAR_RPC_URL")
	if rpcURL == "" {
		rpcURL = "https://soroban-testnet.stellar.org"
	}
	merchantAddress := os.Getenv("MERCHANT_ADDRESS")
	poller := stellar.NewPoller(database, rpcURL, merchantAddress)
	go poller.Start(ctx)

	server := api.NewServer(database)
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	if err := server.Start(port); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
