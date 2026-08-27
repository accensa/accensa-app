# Web Dashboard Route Error Handling Audit

**Audit Date:** August 27, 2026  
**Auditor:** Accensa Engineering / Stellar Wave Contributor  
**Repository:** `accensa/accensa-app` (`apps/web`)  
**Scope:** Browser devtools & network failure audit across all 7 frontend-consumed API routes and middleware.  
**Related Issues:** Closes #203, relates to #201, #204.

---

## 1. Executive Summary

This audit evaluated all error handling and failure modes across the seven API routes consumed by the Accensa web application:

1. `GET /api/payments`
2. `POST /api/sync` & `GET /api/sync`
3. `POST /api/verify`
4. `POST /api/refund/preflight`
5. `GET /api/auth/challenge`
6. `POST /api/auth/verify`
7. `POST /api/auth/logout`
8. `middleware.ts` (edge route protection and session token validation)

### Key Findings

1. **401 Session Expiry Mislabel (Fixed):** Prior to this audit, when a session cookie expired or was deleted during steady-state polling, `/api/payments` returned `401 Unauthorized`. The dashboard rendered this as a generic red `"Connection Error: Unauthorized"` panel with a `"Try Again"` button. This misled merchants into believing network infrastructure was down rather than prompting them to re-authenticate. This has been resolved in this PR by introducing explicit detection for session expiration (`Session Expired` with a direct `Sign In Again` action link).
2. **Sync Rate Limiting (429):** The `SyncNowButton` accurately processes HTTP 429 responses with `Retry-After` headers, activating a graceful countdown cooldown timer.
3. **Receipt & Refund Preflight Failures:** Form validations, local vs on-chain verification disagreement handling, and contract preflight rejections (`AlreadyRefunded`, insufficient float, window expired) render informative feedback banners.

---

## 2. Route-by-Route Failure Mode Enumeration

### 2.1 `middleware.ts`

- **Route Path:** `/dashboard/*`, `/api/*`
- **Protection Scope:** Gated private APIs and dashboard routes.
- **Failure Modes:**
  - **Missing `JWT_SECRET_KEY`:** Returns HTTP 500 `{ "error": "Server misconfigured: JWT_SECRET_KEY is not set" }`.
  - **Missing `accensa_session` Cookie on Private API:** Returns HTTP 401 `{ "error": "Unauthorized" }`.
  - **Missing `accensa_session` Cookie on Dashboard Page:** Returns HTTP 307 Redirect to `/login`.
  - **Invalid / Expired JWT Signature:** Returns HTTP 401 (API) or redirects to `/login` (Page).
  - **Valid JWT without `publicKey` payload:** Returns HTTP 401 (API) or redirects to `/login` (Page).
  - **Unauthenticated `GET /api/sync` without `CRON_SECRET`:** Returns HTTP 401 `{ "error": "Unauthorized" }`.

### 2.2 `GET /api/payments`

- **Route Path:** `apps/web/src/app/api/payments/route.ts`
- **Failure Modes:**
  - **Missing `DATABASE_URL`:** Returns HTTP 500 `{ "error": "Internal Server Error" }`.
  - **Invalid `limit` parameter (`limit=-5`, `limit=abc`, `limit=1001`):** Returns HTTP 400 `{ "error": "limit must be an integer between 1 and 1000" }`.
  - **Invalid `cursor` parameter (malformed base64, missing pipe, non-date timestamp, invalid txHash):** Returns HTTP 400 `{ "error": "invalid_cursor" }`.
  - **Unauthenticated Request:** Returns HTTP 401 `{ "error": "Unauthorized" }`.
  - **Database Query Failure:** Returns HTTP 500 `{ "error": "Internal Server Error" }`.

### 2.3 `POST /api/sync` & `GET /api/sync`

- **Route Path:** `apps/web/src/app/api/sync/route.ts`
- **Failure Modes:**
  - **Missing `DATABASE_URL`:** Returns HTTP 500 `{ "error": "DATABASE_URL is not configured" }`.
  - **Unauthenticated POST (Missing session):** Returns HTTP 401 `{ "error": "Unauthorized" }`.
  - **Cooldown Active (POST):** Returns HTTP 429 `{ "success": true, "cooldown": true, "retryAfterMs": <ms> }` with header `Retry-After: <seconds>`.
  - **Unauthenticated GET (Invalid `CRON_SECRET` bearer token):** Returns HTTP 401 `{ "error": "Unauthorized" }`.
  - **No Configured Merchants (GET):** Returns HTTP 500 `{ "error": "No merchants are configured" }`.
  - **Soroban RPC Connectivity Failure:** Retries 3 times with exponential backoff before throwing HTTP 500 `{ "success": false, "error": "Internal Server Error" }`.

### 2.4 `POST /api/verify`

- **Route Path:** `apps/web/src/app/api/verify/route.ts`
- **Failure Modes:**
  - **Non-JSON Request Body:** Returns HTTP 400 `{ "error": "Request body must be JSON" }`.
  - **Invalid `batchId` (non-integer, <= 0):** Returns HTTP 400 `{ "error": "batchId must be a positive integer" }`.
  - **Invalid `leaf` (non-hex, != 64 chars):** Returns HTTP 400 `{ "error": "leaf must be a hex-encoded 32-byte hash" }`.
  - **Invalid `proof` (non-array, invalid hash items):** Returns HTTP 400 `{ "error": "proof must be an array of hex-encoded 32-byte hashes" }`.
  - **Batch Not Found On-Chain:** Returns HTTP 404 `{ "error": "Could not read batch #<id>." }`.
  - **Proof Mismatch:** Returns HTTP 200 `{ "local": {"ok": false}, "onchain": {"ok": false}, "verified": false, "disagreement": false }`.
  - **Soroban RPC Error:** Returns HTTP 200 with `onchain: { "ok": null, "error": "On-chain verification failed" }`, `verified: false`.

### 2.5 `POST /api/refund/preflight`

- **Route Path:** `apps/web/src/app/api/refund/preflight/route.ts`
- **Failure Modes:**
  - **Non-JSON Request Body:** Returns HTTP 400 `{ "error": "Request body must be JSON" }`.
  - **Missing required fields (`txHash`, `recipient`, `merchant`):** Returns HTTP 400 `{ "error": "txHash, recipient, and merchant are required" }`.
  - **Invalid `amount` (non-digit, "0"):** Returns HTTP 400 `{ "error": "amount must be a positive integer string in stroops" }`.
  - **Invalid `paidAtLedger` (< 0, non-integer):** Returns HTTP 400 `{ "error": "paidAtLedger must be a ledger number" }`.
  - **Unauthenticated caller:** Returns HTTP 401 `{ "error": "Unauthorized" }`.
  - **Contract Rejection (AlreadyRefunded / WindowExpired / FloatExceeded):** Returns HTTP 200 `{ "contract": "...", "existing": {...}, "preflight": {"status": "rejected", "message": "..."} }`.

### 2.6 `GET /api/auth/challenge`

- **Route Path:** `apps/web/src/app/api/auth/challenge/route.ts`
- **Failure Modes:**
  - **Missing `address` query param:** Returns HTTP 400 `{ "error": "address query parameter is required" }`.
  - **Unknown merchant address:** Returns HTTP 404 `{ "error": "Unknown merchant" }`.
  - **Database error:** Returns HTTP 500.

### 2.7 `POST /api/auth/verify`

- **Route Path:** `apps/web/src/app/api/auth/verify/route.ts`
- **Failure Modes:**
  - **Missing `xdr`:** Returns HTTP 400 `{ "error": "Missing xdr" }`.
  - **Expired timebounds:** Returns HTTP 401 `{ "error": "Challenge expired or invalid" }`.
  - **Invalid source account / unregistered merchant:** Returns HTTP 401 `{ "error": "Invalid source account" }`.
  - **Invalid signature:** Returns HTTP 401 `{ "error": "Invalid signature" }`.
  - **Invalid challenge structure:** Returns HTTP 401 `{ "error": "Invalid challenge structure" }`.
  - **Reused or invalid nonce:** Returns HTTP 401 `{ "error": "Invalid or reused nonce" }`.
  - **Malformed transaction XDR:** Returns HTTP 400 `{ "error": "<parser error>" }`.

### 2.8 `POST /api/auth/logout`

- **Route Path:** `apps/web/src/app/api/auth/logout/route.ts`
- **Success/Failure:** Destroys the cookie and returns HTTP 200 `{ "success": true }`.

---

## 3. Browser DevTools Audit & Findings Table

| Route                            | Tested Failure Scenario                      | HTTP Status                  | Response Shape                                                                                                  | Observed UI Presentation                                                                                                                                         | Actionability & Recovery                                                                              | Verdict                  |
| :------------------------------- | :------------------------------------------- | :--------------------------- | :-------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- | :----------------------- |
| **`GET /api/payments`**          | Session cookie expired/deleted mid-poll      | `401 Unauthorized`           | `{"error": "Unauthorized"}`                                                                                     | Displays `"Session Expired"` header with `"Session expired. Please sign in again."` and `"Sign In Again"` button. Top status pill displays `"Sign In Required"`. | Actionable: clicking `"Sign In Again"` routes merchant to `/login` without losing navigation context. | **PASSED (Fixed in PR)** |
| **`GET /api/payments`**          | Database unreachable / 500 error             | `500 Internal Server Error`  | `{"error": "Internal Server Error"}`                                                                            | Displays `"Connection Error"` panel with retry button; StatusPill shows `"Retry Connection"`.                                                                    | Actionable: clicking `"Try Again"` retries without requiring full page reload.                        | **PASSED**               |
| **`GET /api/payments`**          | Network offline (`navigator.onLine = false`) | `TypeError: Failed to fetch` | Client transport exception                                                                                      | Polling automatically paused; renders `"No internet connection. Data shown may be out of date."`                                                                 | Actionable: refetches immediately upon network reconnection event.                                    | **PASSED**               |
| **`POST /api/sync`**             | Triggered within 60s cooldown                | `429 Too Many Requests`      | `{"success": true, "cooldown": true, "retryAfterMs": 42000}`                                                    | Button updates label to `"Wait 42s"`, disabled during cooldown, decrements every second.                                                                         | Actionable: Automatically re-enables when cooldown timer expires.                                     | **PASSED**               |
| **`POST /api/sync`**             | Session expired on manual sync               | `401 Unauthorized`           | `{"error": "Unauthorized"}`                                                                                     | Button turns red with label `"Retry sync"` and title text `"Unauthorized"`.                                                                                      | Actionable: Merchant can re-authenticate or retry.                                                    | **PASSED**               |
| **`POST /api/verify`**           | Non-existent Batch ID (#999999)              | `404 Not Found`              | `{"error": "Could not read batch #999999."}`                                                                    | Alert banner: `"Verification Error: Could not read batch #999999."`.                                                                                             | Actionable: Merchant/agent can adjust batch ID in form and re-submit.                                 | **PASSED**               |
| **`POST /api/verify`**           | Forged Leaf / Invalid Merkle Proof           | `200 OK`                     | `{"verified": false, "disagreement": false, "local": {"ok": false}, "onchain": {"ok": false}}`                  | Prominent red banner: `"Proof Rejected"`, detail cards highlight Local Compute Failed and Ledger Contract Failed.                                                | Actionable: Clearly distinguishes between system error and mathematical rejection.                    | **PASSED**               |
| **`POST /api/refund/preflight`** | Payment already refunded on-chain            | `200 OK`                     | `{"existing": {"amount": "5000000", "recipient": "G...", "ledger": 1200}, "preflight": {"status": "rejected"}}` | Amber note: `"Already refunded: 0.5 XLM to G... at ledger 1200. A payment can only be refunded once."`                                                           | Actionable: Prevents duplicate refund transaction signing.                                            | **PASSED**               |
| **`POST /api/refund/preflight`** | Float exhausted or window expired            | `200 OK`                     | `{"preflight": {"status": "rejected", "message": "Refund window closed."}}`                                     | Amber note showing contract rejection message with `"Re-check"` button.                                                                                          | Actionable: Merchant informed why contract will reject before signing.                                | **PASSED**               |
| **`GET /api/auth/challenge`**    | Unregistered merchant address                | `404 Not Found`              | `{"error": "Unknown merchant"}`                                                                                 | Red alert box on login page: `"Unknown merchant"`.                                                                                                               | Actionable: Merchant prompted to verify connected wallet address.                                     | **PASSED**               |
| **`POST /api/auth/verify`**      | Expired timebounds / signature mismatch      | `401 Unauthorized`           | `{"error": "Challenge expired or invalid"}`                                                                     | Red alert box on login page: `"Challenge expired or invalid"`.                                                                                                   | Actionable: User can click `"Connect Wallet"` to generate a fresh challenge.                          | **PASSED**               |

---

## 4. DevTools Traces & HAR Excerpts

### Trace A: Session Expiry during Dashboard Polling (`GET /api/payments`)

```http
GET /api/payments HTTP/1.1
Host: localhost:3000
Accept: */*
Sec-Fetch-Site: same-origin
Sec-Fetch-Mode: cors
Sec-Fetch-Dest: empty
Cache-Control: no-store

HTTP/1.1 401 Unauthorized
Content-Type: application/json
Cache-Control: no-store, no-cache, must-revalidate, max-age=0
Date: Thu, 27 Aug 2026 05:39:10 GMT
Connection: keep-alive

{"error": "Unauthorized"}
```

- **Client Handling:** Intercepted by `apps/web/src/app/dashboard/page.tsx` -> throws `Error("Session expired. Please sign in again.")` -> renders `Session Expired` card with `Sign In Again` button.

### Trace B: Rate-Limited Manual Sync (`POST /api/sync`)

```http
POST /api/sync HTTP/1.1
Host: localhost:3000
Content-Type: application/json
Cookie: accensa_session=eyJhbGciOi...

HTTP/1.1 429 Too Many Requests
Retry-After: 48
Content-Type: application/json
Date: Thu, 27 Aug 2026 05:39:12 GMT

{"success": true, "cooldown": true, "retryAfterMs": 47820}
```

- **Client Handling:** Intercepted by `SyncNowButton` -> sets state `{ phase: 'cooldown', until: Date.now() + 47820 }` -> updates button label countdown.

### Trace C: Proof Verification Rejection (`POST /api/verify`)

```http
POST /api/verify HTTP/1.1
Host: localhost:3000
Content-Type: application/json

{"batchId": 1, "leaf": "16b138aabc889c21114436424e13132bd8928d2c21b4ac5a9ac5198104efb42c", "proof": ["7ca64ee6..."]}

HTTP/1.1 200 OK
Content-Type: application/json

{
  "local": {"ok": false},
  "onchain": {"ok": false},
  "verified": false,
  "disagreement": false,
  "batch": {
    "id": 1,
    "root": "e9b282...",
    "count": 10,
    "periodStart": 1787700000,
    "periodEnd": 1787703600
  },
  "contract": "CBHRJU7CF4XIFRNDITFHNQHABKBMFM2FYFHLGWN3JGSFYYCDSMDAWPRV"
}
```

---

## 5. Changes Made in this PR vs Follow-up Recommendations

### Fixed in this PR:

1. **Resolved 401 Mislabel in Dashboard:** Changed `/dashboard` and `/dashboard/routes` error parsing to differentiate 401 Unauthorized from network connection failures, presenting clear `"Session Expired"` messaging and a `"Sign In Again"` link.
2. **Updated StatusPill:** Added authentication state check so the top status pill displays `"Sign In Required"` with a direct login link rather than an active `"Retry Connection"` button that would repeatedly fail.
3. **Persistence of Refunded States:** Connected localStorage load and save handlers for refunded transaction hashes.

### Recommended Follow-up Issues:

1. **Automatic Session Refresh / Token Rotation:** Support silent refresh for JWT sessions prior to expiration.
2. **Global Auth Interceptor:** Standardize client-side fetch wrappers to emit an authentication event when any private route returns 401.
3. **Offline Sync Queueing:** Queue manual sync requests while offline to execute automatically upon connection restoration.
