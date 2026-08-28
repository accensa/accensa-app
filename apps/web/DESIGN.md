# Auth Design

## Model Choice: Stellar Wallet Auth (SEP-10-style)

To secure the dashboard and private API routes, we use a Stellar Wallet Auth model (similar to SEP-10). The merchant proves control of `MERCHANT_ADDRESS` by signing a randomly generated challenge string using their Stellar wallet (e.g. Freighter).

### Rationale

- The merchant's Stellar address already serves as their identity in the product.
- It removes the need for managing conventional passwords.
- It is highly secure since it relies on Ed25519 signatures over a nonce.
- Requires no external providers or complex setups.

### Flow

1. Client requests a challenge (`GET /api/auth/challenge`).
2. Server returns a cryptographically secure random string.
3. Client signs this string with their Stellar wallet.
4. Client sends the signature and their public key back to the server (`POST /api/auth/verify`).
5. Server verifies the signature using `@stellar/stellar-sdk` and ensures the public key matches the configured `MERCHANT_ADDRESS`.
6. If valid, the server issues an HTTP-only JWT cookie (`accensa_session`).

### Scope

- **Public**: `/verify`, `POST /api/verify`, `GET /api/receipts/:txHash`, landing pages, docs.
- **Private**: `/dashboard`, `/dashboard/routes`, `/api/payments`, `/api/routes`, `/api/refund/preflight`, `POST /api/sync`, `/api/anchor/*`.
- **Special**: `GET /api/sync` and `GET /api/webhooks/deliver` remain protected by `CRON_SECRET` for automated GitHub Action workflows. Webhook delivery is a separate path from indexing so a merchant endpoint cannot stall the ledger cursor.

### Session Handling

- **Lifetime**: 24 hours.
- **Storage**: HTTP-only, secure, SameSite=Lax cookie.
- **Compromise**: If compromised, it grants read access to payment and revenue records, and the ability to trigger a manual sync (bounded by cooldown). It does NOT grant the ability to move funds (which requires the merchant's private key).
