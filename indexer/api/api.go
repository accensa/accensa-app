package api

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/accensa/accensa-app/indexer/db"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type Server struct {
	db     *db.DB
	router *chi.Mux
}

func NewServer(database *db.DB) *Server {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	s := &Server{
		db:     database,
		router: r,
	}

	r.Get("/health", s.handleHealth)
	r.Get("/api/payments", s.handleGetPayments)
	r.Post("/api/demo", s.handleDemoInject)
	// Path B hook endpoint
	r.Post("/hook/settle", s.handleHookSettle)

	return s
}

func (s *Server) Start(port string) error {
	log.Printf("Starting API server on port %s", port)
	return http.ListenAndServe(":"+port, s.router)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}

func (s *Server) handleGetPayments(w http.ResponseWriter, r *http.Request) {
	// Simple CORS
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

	payments, err := s.db.GetPayments(r.Context())
	if err != nil {
		log.Printf("Error fetching payments: %v", err)
		http.Error(w, `{"error":"failed to fetch payments"}`, http.StatusInternalServerError)
		return
	}

	if payments == nil {
		payments = []db.Payment{} // Return empty array instead of null
	}

	if err := json.NewEncoder(w).Encode(payments); err != nil {
		log.Printf("Error encoding payments: %v", err)
	}
}


type HookPayload struct {
	TxHash    string `json:"tx_hash"`
	Route     string `json:"route"`
	Method    string `json:"method"`
	Price     string `json:"price"`
	RequestID string `json:"request_id"`
}

func (s *Server) handleHookSettle(w http.ResponseWriter, r *http.Request) {
	var payload HookPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// For Path B, we receive the settlement payload and need to update the DB record
	// if it exists, or insert a stub that the poller will fill in later.
	// Since this is a scaffold, we'll just log it for now.
	log.Printf("Received Path B hook for tx_hash: %s, route: %s", payload.TxHash, payload.Route)

	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleDemoInject(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	payments := []db.Payment{
		{TxHash: "4f8a3c8e5d0b9f2a1c7e6d4b3a9f8e7d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7", Ledger: 120456, Payer: "GBBUYER...XYP4", Amount: 150.00, Asset: "USDC", Timestamp: "2026-07-13T12:00:00Z"},
		{TxHash: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f", Ledger: 120459, Payer: "GDALICE...QR6S", Amount: 24.50, Asset: "USDC", Timestamp: "2026-07-13T12:02:00Z"},
		{TxHash: "1f2e3d4c5b6a79887766554433221100ffeeddccbbaa9988776655443322110", Ledger: 120462, Payer: "GCBOB4T...9P0A", Amount: 500.00, Asset: "USDC", Timestamp: "2026-07-13T12:05:00Z"},
	}

	for _, p := range payments {
		if err := s.db.InsertPayment(ctx, p); err != nil {
			log.Printf("Failed to insert %s: %v", p.TxHash, err)
		}
	}
	
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"demo injected"}`))
}
