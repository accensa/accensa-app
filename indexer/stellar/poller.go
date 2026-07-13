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
	
	// The Soroban JSON-RPC request for getEvents
	payload := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "getEvents",
		"params": map[string]interface{}{
			"startLedger": startLedger,
			"filters": []map[string]interface{}{
				{
					"type": "contract",
					"contractIds": []string{p.merchant},
				},
			},
			"limit": 100,
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("Failed to marshal event request: %v", err)
		return
	}

	resp, err := http.Post(p.rpcURL, "application/json", bytes.NewBuffer(body))
	if err != nil {
		log.Printf("Failed to fetch events: %v", err)
		return
	}
	defer resp.Body.Close()

	var result struct {
		Result struct {
			Events []struct {
				Id             string `json:"id"`
				Type           string `json:"type"`
				Ledger         int    `json:"ledger"`
				LedgerClosedAt string `json:"ledgerClosedAt"`
				ContractId     string `json:"contractId"`
				Topic          []string `json:"topic"`
				Value          struct {
					Xdr string `json:"xdr"`
				} `json:"value"`
			} `json:"events"`
		} `json:"result"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("Failed to decode events: %v", err)
		return
	}

	for _, event := range result.Result.Events {
		log.Printf("Found new event for merchant contract: %s", event.Id)
		// For the demo, we decode basic event metadata. 
		// Real applications should use github.com/stellar/go/xdr to decode the exact amount/payer from event.Value.Xdr
		txHash := event.Id
		payer := "G" + event.ContractId[1:5] + "..." + event.ContractId[len(event.ContractId)-4:] // Mocked payer address for demo display
		
		err = p.db.InsertPayment(context.Background(), txHash, float64(10.00), payer, event.LedgerClosedAt)
		if err != nil {
			log.Printf("Failed to save payment event to database: %v", err)
		}
	}
}
