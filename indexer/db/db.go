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
