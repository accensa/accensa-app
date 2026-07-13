# Accensa Dashboard and Indexer

![Stellar](https://img.shields.io/badge/stellar-x402-blue.svg)
![Drips Wave](https://img.shields.io/badge/wave-active-success.svg)

Accensa is the merchant back-office for x402 sellers on Stellar. This repository contains the Go indexer that reconstructs a seller's payment history from chain data, and the Next.js dashboard where a merchant sees revenue by route and proves payments.

## Architecture

*   **Indexer (Go):** Polls the Stellar network for SAC transfer events to the merchant's address and stores them in PostgreSQL. Also exposes an API for the dashboard.
*   **Web (Next.js):** Dashboard for viewing payments, analytics, and interacting with the anchored batches.
*   **SDK (TypeScript):** Middleware hooks for your x402 endpoints to track route-level attribution.

## Getting Started

To run locally:

1.  Start the database: `docker run --name pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres`
2.  Start the indexer:
    ```bash
    cd indexer
    export DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
    go run main.go
    ```
3.  Start the frontend:
    ```bash
    cd apps/web
    pnpm install
    pnpm dev
    ```

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md) for how to pick up open issues.

## Maintainers
- Victor Adeleke

## License
MIT