# Accensa Design System

This document outlines the core principles and implementation details of the Accensa web application design system.

> This file also carries architectural designs that the project's process
> requires to be written down and reviewed before implementation. See
> "Multi-merchant support" below for the current one.

## 0. Multi-merchant support (issue #103)

### Problem

The app was single-merchant by construction: `MERCHANT_ADDRESS` was one environment
variable, `payments` had no merchant column, and `sync_state` was a singleton by
database `CHECK` constraint. Serving a second merchant meant a whole second
deployment — database, Vercel project, cron, secrets — which is infrastructure work,
not a product feature. Issue #87 (dashboard/API authentication) blocked this: scoping
data per merchant needs an authenticated identity to scope it by, which #87 now
provides via the `accensa_session` JWT cookie.

### Data model

A `merchants` table, keyed by Stellar address (`migrations/003_multi_merchant.sql`):

```
merchants
  id                  SERIAL PRIMARY KEY
  address             VARCHAR(56) UNIQUE NOT NULL   -- identity: auth, indexer filter
  public_key_hex      VARCHAR(64)                   -- verifies /api/hook/settle reports
  asset_contract_ids  TEXT                          -- null = fall back to ASSET_CONTRACT_IDS
  refund_vault_id     VARCHAR(56)                   -- null = fall back to NEXT_PUBLIC_REFUND_VAULT_ID
  webhook_url         TEXT                          -- null = fall back to WEBHOOK_URL
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
```

`payments` gains `merchant_id`, and its primary key becomes `(merchant_id, tx_hash)`
rather than `tx_hash` alone — a single Stellar transaction can in principle transfer
to two different merchants at once, so the identity that must be unique is the pair,
not the hash. `sync_state`'s singleton `CHECK (id = 1)` is replaced with a normal
primary key on `merchant_id`, so each merchant gets its own ledger cursor.
`challenge_nonces` gains a nullable `merchant_id` so a nonce minted for one
merchant's login challenge cannot be replayed against another's.

**Why two keys per merchant (`address` and `public_key_hex`) instead of one?** They
already were two different things before this change (`MERCHANT_ADDRESS` and
`MERCHANT_PUBLIC_KEY`): the Stellar address is the on-chain identity a transfer is
addressed to and the account that signs into the dashboard, while the settlement
report key only ever needs to verify an Ed25519 signature over an HTTP body. A
seller's settlement-reporting key does not have to be their Stellar signing key, and
requiring otherwise would be a regression from what single-merchant deployments could
already do.

### Migration and backwards compatibility

`ensureSchema()` (`apps/web/src/lib/db.ts`) runs this migration idempotently on every
request, the same pattern 001 and 002 already used, and the SQL is also committed as
`migrations/003_multi_merchant.sql` with a documented, reversible DOWN section. A
deployment upgrading with `MERCHANT_ADDRESS` (and optionally `MERCHANT_PUBLIC_KEY`)
already set gets exactly one `merchants` row inserted automatically and every existing
`payments`/`sync_state` row backfilled onto it — no manual SQL, no new environment
variables, and the deployment keeps working unchanged as a single-merchant instance.
Onboarding merchant #2 means inserting one more `merchants` row (`INSERT INTO
merchants (address) VALUES (...)`), not standing up new infrastructure.

### Query scoping and defence in depth

Every query against `payments` and `sync_state` takes an explicit `merchant_id`
parameter — there is no code path that reads either table unscoped. Behind that,
`migrations/003_multi_merchant.sql` also turns on Postgres row-level security with
`FORCE ROW LEVEL SECURITY` (not just `ENABLE`, so it binds even the role this app
connects as) and a policy comparing `merchant_id` against a Postgres session variable,
`accensa.merchant_id`. `withMerchantClient()` (`apps/web/src/lib/db.ts`) sets that
variable once per request-scoped connection before running any query. The net effect:
a query that forgets its own `WHERE merchant_id = $1` returns zero rows instead of
every merchant's data — a mistake fails closed, not open. This is the two lines of
defence the issue asked for: application-level scoping, with RLS behind it as the
line that holds if the first one is ever missed.

_Caveat, stated plainly_: RLS can never override a role with `BYPASSRLS` or `SUPERUSER`
privileges — Postgres does not allow it to. In production this app should connect as
a role with neither. A local Postgres superuser (the Docker Compose default) will
bypass RLS regardless of `FORCE`, so the RLS-specific integration test in
`apps/web/src/lib/db.integration.test.ts` is meaningful proof only against a
non-superuser connection; application-level scoping is what actually protects a
default local setup, which is exactly why it exists as the first line rather than the
only one.

Cross-tenant read isolation is asserted directly in
`apps/web/src/app/api/cross-tenant-isolation.test.ts` for every read endpoint
(`/api/payments`, `/api/routes`), and per-merchant cursor independence — including a
quiet merchant whose cursor must still advance, which is precisely the bug that
caused the original four-day outage — is asserted in `db.integration.test.ts`.

### Indexing

`GET /api/sync` (the scheduled entry point) now loads every configured merchant and
sweeps each in turn within one invocation, rather than one deployment sweeping one
address. Filtering server-side on a _set_ of addresses in a single RPC sweep would
scale better than N separate sweeps, but was not pursued here because the Soroban RPC
`getEvents` filter path exercised by `addressTopicFilter()` is documented and tested
against a single topic value; batching many merchants' addresses into one filter is
future work once there are enough merchants for N sequential sweeps to matter. Each
merchant keeps its own cursor (`sync_state.merchant_id`) and its own retention-skip
accounting, and — critically — a merchant with zero matching events in a sweep still
has its cursor advanced to the swept-through ledger, not left standing still. The
response body reports both a per-merchant `results` array and deployment-wide
`syncedTo`/`skippedLedgers`/`drained` maximums, so `.github/workflows/sync.yml`'s
existing health-check greps (`"syncedTo"`, `"skippedLedgers":[1-9]`) keep working
unchanged whether the deployment has one merchant or many.

`POST /api/sync` (the dashboard's manual "Sync now" button) resolves the merchant from
the authenticated session and syncs only that merchant — a signed-in merchant can
trigger their own re-sync, never anyone else's.

### Per-merchant configuration

Signing key and asset list live on the `merchants` row itself. Refund vault and
webhook URL are also per-merchant columns with a deployment-wide fallback, resolved in
`apps/web/src/lib/merchants.ts` (`Merchant.refundVaultId`, `Merchant.webhookUrl`) —
see `apps/web/src/app/api/refund/preflight/route.ts` and the webhook dispatch in
`apps/web/src/app/api/sync/route.ts` for where the fallback is applied.

### Authentication changes

`GET /api/auth/challenge` now takes a required `?address=` query parameter and looks
up the corresponding `merchants` row (404 if unknown) before building the SEP-10-style
challenge transaction, because the transaction's source account _is_ the merchant
being authenticated and must be chosen before it is built and signed.
`POST /api/auth/verify` needs no equivalent wire change: the merchant is read back out
of the already-signed transaction's `source` field, then looked up the same way.

`POST /api/hook/settle` accepts no merchant identifier in its payload at all — adding
one would break every existing `@accensa/sdk` integration mid-flight. Instead, the
signature itself carries the identity: each configured merchant's `public_key_hex` is
tried against the request signature in turn, and whichever one verifies is who
reported it (`apps/web/src/app/api/hook/settle/route.ts`, `verifyingMerchant()`). With
a small number of merchants per deployment this is cheap, and onboarding a merchant's
settlement reporting needs only a new `merchants` row, never an SDK change.

`apps/web/src/middleware.ts` decodes the verified session JWT and forwards the
merchant's Stellar address as the `x-accensa-merchant` request header, so route
handlers trust that header for scoping instead of each re-verifying and re-decoding
the session cookie independently. The header can't be forged by a caller: middleware
runs first and overwrites it on every request it forwards.

### Scope not covered by this change

Multi-merchant _is_ the roadmap here, so the "scope this honestly" alternative in the
issue (closing it as a stated single-tenant limitation) does not apply — see the
tenancy section in `README.md`. Not covered: a UI for merchant self-service signup
(merchants are provisioned by inserting a `merchants` row directly today), and
batching multiple merchants' addresses into a single RPC `getEvents` sweep (see
"Indexing" above).

## 1. Core Philosophy

The design philosophy for Accensa revolves around **Premium Glassmorphism**. The goal is to create a dynamic, engaging, and high-fidelity interface that feels physical and reactive to the user. We emphasize vivid colors, deep blurs, and crisp specular highlights to simulate frosted glass resting over a glowing, ambient background.

## 2. Global Aesthetics

- **Themes**: We explicitly support only two modes: Light and Dark. System-level auto-switching is disabled by default to maintain deterministic visual presentation, preventing awkward UI states where the OS preference overrides the user's manual toggle.
- **Typography**: Uses the `Geist` font family (Sans and Mono) for a sharp, modern, and highly legible look, matching high-end tech SaaS products.
- **Performance**: We employ `disableTransitionOnChange` on the theme provider. This temporarily suspends the global 300ms CSS transitions during a theme switch, ensuring the layout flips instantly without causing heavy GPU crossfades across hundreds of blurred elements.

## 3. The Glassmorphic Stack

Our glassmorphism effect is built using Tailwind CSS via a combination of backgrounds, borders, shadows, and backdrop filters.

### 3.1. Ambient Background Glows

Glass only looks like glass if it has something colorful beneath it to distort and blur.

- We use large, fixed, absolutely positioned `div` orbs in the root layout (Emerald, Teal, Sky, and Indigo).
- **Light Mode**: Opacities hover around `30%-40%` with `mix-blend-multiply` to darken and saturate overlapping colors.
- **Dark Mode**: Opacities drop to `15%-20%` with `mix-blend-screen` to brighten the overlapping colors against the near-black background (`#04090f`).
- **Blur**: The orbs are heavily diffused using `blur-[120px]`.

### 3.2. Surface Properties (The Glass)

All cards, dropdowns, and modals use a standardized frosted glass treatment:

- **Base Background**: `bg-white/50` (Light Mode) and `dark:bg-white/5` or `dark:bg-black/20` (Dark Mode).
- **Backdrop Blur**: `backdrop-blur-2xl` or `backdrop-blur-3xl` forces the background orbs to heavily diffuse when scrolled under the elements.
- **Physical Borders**: A subtle translucent border (`border-slate-200/60` and `dark:border-white/20`) provides the bevel of the glass edge.

### 3.3. Specular Highlights & Depth

To simulate the physical depth and light refraction of glass, we use intense inset shadows:

- **Light Mode**: `inset 0 1px 1px rgba(255,255,255,0.8)` creates a strong, sharp white highlight along the top inner edge of the container.
- **Dark Mode**: `inset 0 1px 1px rgba(255,255,255,0.15)` creates a subtle light catch on the top edge.
- **Drop Shadows**: We pair the inset highlight with soft, dispersed drop shadows (`shadow-[0_8px_32px_rgba(0,0,0,0.5)]` in dark mode) so the glass elements appear to float.

## 4. Mobile Responsiveness and Interactions

- **Tap Interactions**: Hover effects on mobile iOS Safari can trap the first tap (the "double-tap bug"). To solve this, all hover states (e.g., `hover:bg-white/60`) are strictly scoped to desktop using the `md:` breakpoint (`md:hover:bg-white/60`).
- **Active States**: For touch devices, we use the `active:` pseudo-class (e.g., `active:bg-white/60`) to provide instant physical feedback when a button or toggle is pressed, without interfering with the click event.
- **Navigation**: Mobile layouts consolidate links into a backdrop-blurred hamburger dropdown (`backdrop-blur-3xl`) to save screen real estate.

## 5. Tailwind Implementation Example

A standard glass card implementation:

```tsx
<div
  className="
  bg-white/50 dark:bg-white/5
  backdrop-blur-2xl
  border border-slate-200/60 dark:border-white/20
  rounded-3xl
  p-8
  shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)]
  dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)]
  transition-colors duration-300
"
>
  {/* Content */}
</div>
```
