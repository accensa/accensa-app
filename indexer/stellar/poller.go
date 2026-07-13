package stellar

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/accensa/accensa-app/indexer/db"
)

type Poller struct {
	db       *db.DB
	rpcURL   string
	merchant string
}

func NewPoller(database *db.DB, rpcURL string, merchant string) *Poller {
	return &Poller{
		db:       database,
		rpcURL:   rpcURL,
		merchant: merchant,
	}
}

func (p *Poller) Start(ctx context.Context) {
	log.Println("Starting Stellar RPC Poller...")
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	// In a real implementation, we would track the last polled ledger in the DB
	// and fetch events from startLedger to endLedger using getEvents.
	var lastLedger uint64 = 0

	for {
		select {
		case <-ctx.Done():
			log.Println("Poller stopped")
			return
		case <-ticker.C:
			latestLedger, err := p.getLatestLedger()
			if err != nil {
				log.Printf("Error getting latest ledger: %v", err)
				continue
			}

			if lastLedger == 0 {
				lastLedger = latestLedger - 10 // Start a bit back
			}

			if latestLedger > lastLedger {
				p.pollEvents(lastLedger, latestLedger)
				lastLedger = latestLedger
			}
		}
	}
}

func (p *Poller) getLatestLedger() (uint64, error) {
	payload := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "getLatestLedger",
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}

	resp, err := http.Post(p.rpcURL, "application/json", bytes.NewBuffer(body))
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	var result struct {
		Result struct {
			Sequence uint64 `json:"sequence"`
		} `json:"result"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, err
	}

	return result.Result.Sequence, nil
}

func (p *Poller) pollEvents(startLedger, endLedger uint64) {
	log.Printf("Polling events from ledger %d to %d", startLedger, endLedger)
	// Implementation for getEvents goes here.
	// We would filter for topic = ["transfer", <merchant>]
	// and then insert into DB via p.db.pool.Exec(...)
}
