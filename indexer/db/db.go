package db

import (
	"context"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
)

type DB struct {
	pool *pgxpool.Pool
}

func Connect(ctx context.Context, databaseURL string) (*DB, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("unable to connect to database: %w", err)
	}

	err = pool.Ping(ctx)
	if err != nil {
		return nil, fmt.Errorf("unable to ping database: %w", err)
	}

	return &DB{pool: pool}, nil
}

func (db *DB) InitSchema(ctx context.Context) error {
	schema := `
	CREATE TABLE IF NOT EXISTS payments (
		tx_hash VARCHAR(64) PRIMARY KEY,
		ledger BIGINT NOT NULL,
		payer VARCHAR(56) NOT NULL,
		amount NUMERIC NOT NULL,
		asset VARCHAR(64) NOT NULL,
		ts TIMESTAMP NOT NULL,
		route VARCHAR(255),
		method VARCHAR(10),
		request_id VARCHAR(64)
	);

	CREATE INDEX IF NOT EXISTS idx_payments_ts ON payments(ts);
	CREATE INDEX IF NOT EXISTS idx_payments_route ON payments(route);
	`
	_, err := db.pool.Exec(ctx, schema)
	if err != nil {
		return fmt.Errorf("failed to initialize schema: %w", err)
	}
	log.Println("Database schema initialized")
	return nil
}

func (db *DB) Close() {
	db.pool.Close()
}

type Payment struct {
	TxHash    string  `json:"tx_hash"`
	Ledger    int64   `json:"ledger"`
	Payer     string  `json:"payer"`
	Amount    float64 `json:"amount"`
	Asset     string  `json:"asset"`
	Timestamp string  `json:"timestamp"`
	Route     *string `json:"route"`
	Method    *string `json:"method"`
	RequestID *string `json:"request_id"`
}

func (db *DB) GetPayments(ctx context.Context) ([]Payment, error) {
	rows, err := db.pool.Query(ctx, "SELECT tx_hash, ledger, payer, amount, asset, ts, route, method, request_id FROM payments ORDER BY ts DESC LIMIT 100")
	if err != nil {
		return nil, fmt.Errorf("failed to query payments: %w", err)
	}
	defer rows.Close()

	var payments []Payment
	for rows.Next() {
		var p Payment
		var ts interface{}
		err := rows.Scan(&p.TxHash, &p.Ledger, &p.Payer, &p.Amount, &p.Asset, &ts, &p.Route, &p.Method, &p.RequestID)
		if err != nil {
			return nil, fmt.Errorf("failed to scan payment: %w", err)
		}
		p.Timestamp = fmt.Sprintf("%v", ts)
		payments = append(payments, p)
	}
	return payments, nil
}

func (db *DB) InsertPayment(ctx context.Context, p Payment) error {
	_, err := db.pool.Exec(ctx, "INSERT INTO payments (tx_hash, ledger, payer, amount, asset, ts) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tx_hash) DO NOTHING",
		p.TxHash, p.Ledger, p.Payer, p.Amount, p.Asset, p.Timestamp)
	return err
}
