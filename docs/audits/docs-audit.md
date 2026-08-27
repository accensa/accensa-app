# Documentation Audit Against Current Codebase

**Audit Date:** August 27, 2026  
**Auditor:** Accensa Engineering / Stellar Wave Contributor  
**Repository:** `accensa/accensa-app` (`apps/docs`)  
**Scope:** Verification of all documentation pages, code snippets, environment variables, API schemas, and external repository links against actual codebase implementation.  
**Related Issues:** Closes #209, relates to #201, #203, #204.

---

## 1. Executive Summary

A comprehensive documentation audit was performed across all 15 documentation pages in `apps/docs/docs/`. Multiple points of factual drift between the documentation and the shipped code were identified and fixed in this PR.

### Summary of Fixed Inaccuracies

1. **Indexer Language Drift (Fixed):** `user-guides.mdx` referenced "the Go Indexer". The Accensa indexer is implemented in TypeScript within the Next.js application (`apps/web/src/app/api/sync/route.ts`).
2. **Environment Variable Renaming (Fixed):** `onboarding.mdx` and `troubleshooting.mdx` referenced legacy environment variables (`ACCEPTED_ASSETS` instead of `ASSET_CONTRACT_IDS`, `SOROBAN_RPC_URL` instead of `STELLAR_RPC_URL`) and omitted required auth secrets (`JWT_SECRET_KEY`, `CRON_SECRET`).
3. **API Response Shape & Pagination (Fixed):** `developer.mdx` documented `GET /api/payments` as returning a bare array `[{ ... }]` with numeric floats and missing cursor pagination. This has been updated to reflect the actual schema (`{ payments: [...], sync: {...}, next_cursor: string | null }`), stringified amounts to prevent precision loss, and the `limit` / `cursor` parameters.
4. **Hook Authentication Mechanism (Fixed):** `developer.mdx` previously documented a simple Bearer API key. The implementation uses cryptographic Ed25519 signature headers (`X-Signature-Ed25519`, `X-Timestamp`, `X-Merchant-Key`).
5. **Cron Sync Method (Fixed):** `onboarding.mdx` documented `POST /api/sync` for automated cron jobs. In the actual implementation, `GET /api/sync` is the authorized cron endpoint requiring `Authorization: Bearer <CRON_SECRET>`, whereas `POST /api/sync` is the session-authenticated manual dashboard trigger subject to a 60s cooldown.
6. **Sidebar Link Extensions (Fixed):** `sidebars.ts` referenced `.mdx` URLs in external repository links to `accensa-contracts`; updated to standard `.md` links.

---

## 2. Page-by-Page Audit Inventory

| Page Path                             | Title                    | Category    | Drift Identified                                                                       | Severity | Status in PR |
| :------------------------------------ | :----------------------- | :---------- | :------------------------------------------------------------------------------------- | :------- | :----------- |
| `docs/introduction.mdx`               | Introduction             | General     | None. Correctly outlines the 3-repo architecture.                                      | None     | Verified     |
| `docs/architecture.mdx`               | Architecture             | General     | None. Clean repository separation and `/verify` collision disambiguation.              | None     | Verified     |
| `docs/onboarding.mdx`                 | Merchant Onboarding Path | General     | Env var names (`ACCEPTED_ASSETS`, `SOROBAN_RPC_URL`) and `POST /api/sync` cron method. | Medium   | **Fixed**    |
| `docs/user-guides.mdx`                | User Guides              | General     | Outdated reference to "Go Indexer".                                                    | Medium   | **Fixed**    |
| `docs/developer.mdx`                  | Developer Guide          | General     | Stale `/api/payments` shape, missing pagination docs, outdated hook auth mechanism.    | High     | **Fixed**    |
| `docs/troubleshooting.mdx`            | Troubleshooting          | General     | Outdated env var references.                                                           | Low      | **Fixed**    |
| `docs/faq.mdx`                        | FAQ                      | General     | None. Clean overview of micro-payment mechanics and testnet readiness.                 | None     | Verified     |
| `docs/app/overview.mdx`               | App Overview             | Accensa App | None. Accurately links to architecture and dashboard features.                         | None     | Verified     |
| `docs/contracts/overview.mdx`         | Contracts Overview       | Contracts   | None. High-level description matches Soroban contracts.                                | None     | Verified     |
| `docs/facilitator/overview.mdx`       | Facilitator Overview     | Facilitator | None. Accurately scopes off-chain facilitator vs indexer.                              | None     | Verified     |
| `docs/facilitator/buyer-agent.mdx`    | Buyer/Agent Guide        | Facilitator | None. Code examples match SDK and Stellar testnet.                                     | None     | Verified     |
| `docs/facilitator/seller.mdx`         | Seller Guide             | Facilitator | None. Webhook endpoint example is consistent with SDK hook flow.                       | None     | Verified     |
| `docs/facilitator/operator.mdx`       | Operator Guide           | Facilitator | None. Docker, environment, and CLI instructions match testnet setup.                   | None     | Verified     |
| `docs/facilitator/conformance.mdx`    | Conformance Report       | Facilitator | None. Formal report aligns with test cases and testnet parameters.                     | None     | Verified     |
| `docs/facilitator/sync-mechanism.mdx` | Syncing Mechanism        | Facilitator | None. Details single-source authoring in doc site.                                     | None     | Verified     |

---

## 3. Detailed Drift & Resolution Breakdown

### 3.1 Environment Variable Reconciliation

- **Legacy Documentation:**
  ```env
  MERCHANT_ADDRESS=G...
  ACCEPTED_ASSETS=native
  SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
  ```
- **Actual Runtime Codebase (`apps/web/src/lib/` and `.env.example`):**
  ```env
  DATABASE_URL=postgresql://...
  JWT_SECRET_KEY=<secure-secret-key>
  CRON_SECRET=<bearer-token>
  ASSET_CONTRACT_IDS=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
  STELLAR_RPC_URL=https://soroban-testnet.stellar.org
  ```
- **Action Taken:** Updated `onboarding.mdx` and `troubleshooting.mdx` with correct environment variable keys and defaults.

---

### 3.2 `/api/payments` Schema and Pagination

- **Legacy Documentation:**
  ```json
  [
    {
      "tx_hash": "...",
      "amount": 0.001,
      "timestamp": "2026-07-13T10:00:00Z"
    }
  ]
  ```
- **Actual Route Implementation (`apps/web/src/app/api/payments/route.ts`):**
  - Query parameters: `limit` (1-1000), `cursor` (base64 `ts|txHash`).
  - Response headers: `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`.
  - Response JSON:
    ```json
    {
      "payments": [
        {
          "tx_hash": "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b",
          "ledger": 12847294,
          "payer": "GB3A...",
          "amount": "0.0010000",
          "asset": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
          "ts": "2026-07-13T10:00:00.000Z",
          "route": "/api/data",
          "method": "GET"
        }
      ],
      "sync": {
        "updatedAt": "2026-07-13T10:05:00.000Z",
        "lastLedger": 12847300
      },
      "next_cursor": "MjAyNi0wNy0xM1QxMDowMDowMC4wMDBafDZiODZiMjczZmYzNGZjZTE5ZDZiODA0ZWZmNWEzZjU3NDdhZGE0ZWFhMjJmMWQ0OWMwMWU1MmRkYjc4NzViNGI="
    }
    ```
- **Action Taken:** Rewrote the API reference section in `developer.mdx`.

---

### 3.3 Background Cron Sync vs Manual Sync

- **Legacy Documentation:** Instructed users to configure cron jobs targeting `POST /api/sync`.
- **Actual Route Implementation (`apps/web/src/app/api/sync/route.ts`):**
  - `POST /api/sync`: Requires merchant cookie session. Enforces a 60-second cooldown per merchant (`429 Too Many Requests` when triggered repeatedly).
  - `GET /api/sync`: Designed for automated schedulers. Authenticated via `Authorization: Bearer <CRON_SECRET>`. Iterates over all configured merchants and advances sync cursors.
- **Action Taken:** Clarified the distinct purposes and authentication methods of `GET /api/sync` vs `POST /api/sync` in `onboarding.mdx`.

---

## 4. Build & Link Verification

All documentation files were verified using the Docusaurus build pipeline with strict link checking enabled (`onBrokenLinks: 'throw'`).

### Verification Commands & Results

```bash
# TypeScript verification
$ pnpm --filter docs typecheck
✓ tsc passed with 0 errors

# Production build and broken link verification
$ pnpm --filter docs build
[SUCCESS] Generated static files in "build".
```

---

## 5. Ongoing Maintenance Recommendations

1. **Schema Generation from TypeScript Types:** Auto-generate API endpoint documentation from route response interfaces (`PaymentsResponse`, `PaymentRow`) to prevent documentation drift during API refactors.
2. **Automated Doc Code Snippet Typechecking:** Integrate a markdown code-block typechecker (such as `eslint-plugin-mdx` or `typedoc`) in CI to validate TypeScript snippets in `.mdx` files.
3. **Cross-Repo Link Checker:** Set up a scheduled GitHub Action to verify all external cross-repository URLs pointing to `accensa-contracts` and `x402-facilitator-stellar`.
