# `@accensa/sdk`

This SDK enables merchant applications to report x402 payment settlements to an Accensa indexer,
and to build and verify receipt Merkle trees.

## Receipt leaves and `buildBatch`

A production receipt leaf is `SHA-256` of the 32-byte Stellar transaction hash:

```ts
import { receiptLeaf, buildBatch, verifyReceipt } from '@accensa/sdk';

const leaf = receiptLeaf(txHash); // hex-encoded 32-byte hash
const batch = buildBatch([leaf /* more leaves, ledger order */]);
verifyReceipt(leaf, batch.proofs[leaf], batch.root); // true
```

`buildBatch` is the real tree: sorted-pair SHA-256, odd nodes promoted, proofs
in leaf-to-root order — the same convention as `ReceiptAnchor::verify_receipt`
and the vectors in `merkle-vectors.json`. Those vectors pin the tree algorithm
with UTF-8 fixture labels; they do not define the production preimage. The
preimage is `receiptLeaf(tx_hash)` and is documented in
[Receipt leaves](https://accensa.github.io/accensa-app/docs/app/receipt-leaves).

---

This SDK enables merchant applications to report x402 payment settlements to an Accensa indexer.

## Reporting Settlements

Accensa supports merchant-reported route attribution via the `/api/hook/settle` webhook.

To maintain integrity, the payload is authenticated. Sellers using `@accensa/sdk` will have this handled automatically via `createSettleHook` or `attachAccensaHook`.

Signing uses WebCrypto Ed25519 when `globalThis.crypto.subtle` supports it, and falls back to Node.js `crypto` otherwise. The SDK is supported and tested on Node.js, Vercel Edge Functions, Cloudflare Workers, and Deno Deploy. Runtimes without either WebCrypto Ed25519 or Node.js crypto fail loudly rather than sending an unsigned report.

## Security & Key Management

### The Signing Key

**This is a dedicated signing key, generated specifically for settlement reporting.**
**It is NEVER your merchant's Stellar account key.**

Generating a key for this purpose (requires Node.js):

```sh
node -e "const crypto = require('crypto'); console.log(crypto.generateKeyPairSync('ed25519').privateKey.export({format: 'der', type: 'pkcs8'}).toString('hex').slice(32))"
```

Or you can use any standard tool to generate a 32-byte Ed25519 seed in hex.

### Threat Model

- **What the key grants**: The ability to write route attribution for payments
  to the indexer.
- **What it does NOT grant**: The ability to fabricate a payment, move funds, or
  change ledger records. The indexer verifies all payments on-chain, so an
  attacker cannot invent a transaction that never happened on the Stellar ledger.
- **Blast radius**: An attacker with this key can misattribute revenue (e.g.
  assigning analytics credit to a different route) or create attribution for
  real payments to routes that don't exist.
- **Detection**: To detect a compromise, monitor your analytics for attribution
  to routes your application does not serve, or unusual spikes in attribution
  for specific routes that don't match your web traffic.
- **Storage Guidance**: The private key (`privateKeyHex`) must be provided via
  an environment variable at minimum, or ideally fetched from a secret manager
  at runtime. Never commit the key to source control. The SDK is designed to
  ensure the key is never logged (even on failure).

### Key Rotation

Accensa supports key rotation with zero downtime.

During a rollover, your deployment's `MERCHANT_PUBLIC_KEY` environment variable
(or the database `merchants` row) accepts a comma-separated list of multiple
public keys. The indexer will accept a signature from any of them.

1. Generate a new keypair.
2. Add the new public key to the list in your Accensa backend (e.g.
   `MERCHANT_PUBLIC_KEY="old_key,new_key"`).
3. Wait for the new configuration to deploy.
4. Update your seller application to use the new `privateKeyHex` (and pass
   `keyId` to `reportSettlement` / `AccensaHookOptions` so the backend can
   easily identify which key was used if desired).
5. Once all instances are running the new key, remove the old public key from
   the backend. The entire rollover can be safely completed within a short
   maintenance window, but keys can overlap indefinitely if needed.

### Signing Contract (For Non-JS Implementers)

If you are integrating with Accensa from a non-JavaScript environment, you must construct and sign the settlement report yourself.
The reporting contract is as follows:

1. **Construct the JSON payload**:
   Create a JSON object containing the settlement details (e.g., `tx_hash`, `route`, `method`).
2. **Sign the raw request body**:
   The Ed25519 signature is generated over the exact UTF-8 bytes of the request body (the JSON string). Ensure that the bytes signed match the body sent in the HTTP request exactly.
3. **Set the header**:
   Pass the resulting signature as a hex string in the `X-Signature` HTTP header.

The backend verifies this signature before parsing the JSON, ensuring the request is strictly authenticated based on the raw bytes.

## Generated types

`SettleHookPayload` (the shape of that JSON payload) is generated from
[`apps/web/openapi.yaml`](../../apps/web/openapi.yaml), the OpenAPI spec for
the indexer API, rather than hand-declared — see
[issue #169](https://github.com/accensa/accensa-app/issues/169). This closes
the gap where the indexer's API and this SDK's types could drift apart
silently: a change to what `/api/hook/settle` accepts now shows up as a diff
in `generated/api-types.ts`, not a `400` discovered in production.

```bash
pnpm gen:api   # regenerates packages/sdk/generated/api-types.ts from the spec
```

CI regenerates the file and fails the build if it does not match what's
checked in, the same way `gen:vectors` is checked for the Merkle conformance
fixture. Only the wire type the SDK directly depends on
(`SettleHookPayload`) has been switched over so far; the spec also documents
`/api/payments`, `/api/routes`, `/api/verify` and `/api/sync` for the same
treatment later.
## Reading Orders and Products

The SDK ships a small typed client for the Accensa indexer's read API. Every
method returns strict `Order` / `Product` values — no `any`, no
`Record<string, unknown>` — with optional columns (e.g. `metadata`) mapped from
SQL `NULL` to `undefined` so strict null checks work in the consuming app.

```ts
import { AccensaClient } from '@accensa/sdk';

const accensa = new AccensaClient({
  indexerUrl: 'https://accensa-dashboard.vercel.app',
  // The indexer scopes reads to the signed-in merchant; attach whatever
  // credential your deployment expects.
  headers: { Authorization: 'Bearer ...' },
});

// Most recent orders, newest first.
const { orders, nextCursor } = await accensa.listOrders({ limit: 50 });
for (const order of orders) {
  console.log(order.id, order.productId, order.amount, order.createdAt);
}

// One order by transaction hash (searches the most recent 1000 payments).
const order = await accensa.fetchOrder('a'.repeat(64));

// Products (paid endpoints) with their indexed revenue.
const { products } = await accensa.listProducts();
for (const product of products) {
  console.log(product.id, product.calls, product.totalRevenue);
}

// One product by route path (searches the top 200 by revenue).
const product = await accensa.fetchProduct('/api/hello');
```

Prefer the raw mappers when you hold a response body yourself
(e.g. a webhook payload): `orderFromWire`, `ordersFromResponse`,
`productFromWire`, and `productsFromResponse` parse an `unknown` JSON value
into the strict types. The `Order` and `Product` types are also re-exported
from the package root, and available directly from `@accensa/sdk/types`.

## Error Handling

Every error the SDK throws extends the base `AccensaError`, so a single
`instanceof AccensaError` catch handles the whole SDK surface. The subclasses
discriminate the failure modes you actually branch on:

| Class                  | Thrown when                                                                                                 | Metadata         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------- |
| `AccensaAuthError`     | The indexer rejected the credential (HTTP 401/403).                                                         | `status`, `path` |
| `AccensaRateLimitError`| A rate-limited RPC or indexer node answered 429 and the retry budget was spent.                             | `path`, `retryAfterMs` |
| `AccensaNetworkError`  | The indexer could not be reached — `fetch` failed, timed out, or is unavailable.                            | `url`, `cause`   |
| `AccensaContractError` | The indexer (or a receipt) violated the wire contract: a malformed row, a non-JSON body, a bad Merkle hash. | `index`          |
| `AccensaError`         | The base class; also thrown directly for other non-2xx statuses (e.g. 500).                                 | `status`         |

Rate limits are retried automatically: the client waits out `Retry-After`
(up to 3 times) before throwing `AccensaRateLimitError`, so a transient 429
from a public Soroban RPC node never crashes the app mid-poll. Reads are
also served from a short in-memory cache (10s TTL, configurable via
`cacheTtlMs`, `0` to disable), so repeated profile/product reads across page
navigations bypass the network. Call `client.clearCache()` after a write.

```ts
import { AccensaClient, AccensaAuthError, AccensaNetworkError } from '@accensa/sdk';

const accensa = new AccensaClient({ indexerUrl: 'https://accensa-dashboard.vercel.app' });

try {
  const { orders } = await accensa.listOrders();
} catch (error) {
  if (error instanceof AccensaAuthError) {
    // The credential is stale — refresh and retry; the request itself was fine.
    console.error(`auth failed: ${error.status} on ${error.path}`);
  } else if (error instanceof AccensaNetworkError) {
    // Nothing wrong with the request — back off and retry.
    console.error(`could not reach ${error.url}`, error.cause);
  } else {
    throw error;
  }
}
```

The error classes are also available from `@accensa/sdk/errors`.

## Verifying Inbound Webhooks

Merchants receiving webhooks from the Accensa indexer can verify that the
request actually came from Accensa and was not tampered with. Every outbound
webhook is signed with **HMAC-SHA256** using a shared secret, and the hex
digest travels in the `X-Webhook-Signature` header.

```ts
import { signWebhookSignature, verifyWebhookSignature } from '@accensa/sdk';

// Server side — Accensa signs the raw body it is about to POST.
const body = JSON.stringify({ tx_hash: '...', route: '/api/hello' });
const signature = signWebhookSignature(body, process.env.WEBHOOK_SECRET!);

// Merchant side — verify before trusting anything in the payload.
const rawBody = await readRawRequestBody(req); // exact bytes, not re-serialised
if (
  !verifyWebhookSignature(rawBody, req.headers['x-webhook-signature'], process.env.WEBHOOK_SECRET!)
) {
  return res.status(401).json({ error: 'Invalid signature' });
}
```

Two things to get right:

1. **Sign and verify the exact bytes.** The signature is computed over the raw
   request body as sent. Re-serialising the JSON on the receiving side (e.g.
   `JSON.stringify(JSON.parse(body))`) can reorder keys or change whitespace
   and the signature will no longer match.
2. **The comparison is timing-safe.** `verifyWebhookSignature` uses
   `crypto.timingSafeEqual`, so a failed check does not leak how much of the
   digest matched.

`signWebhookSignature` produces the same hex digest the indexer computes, so a
merchant using `verifyWebhookSignature` accepts genuine Accensa webhooks and
rejects forged or altered ones.

## Verifying Receipts On-Chain with `ReceiptAnchorClient`

`verifyReceipt()` (above) checks a receipt off-chain, with no network call, by
recomputing the Merkle root yourself. `ReceiptAnchorClient` is the on-chain
alternative: it reads Accensa's `ReceiptAnchor` contract directly over Soroban
RPC, so the answer comes from the ledger rather than from anything you
computed locally. It lives at a separate entry point,
`@accensa/sdk/receipt-anchor-client`, so importing it (and its
`@stellar/stellar-sdk` dependency) is opt-in and doesn't add weight to the
rest of the SDK.

> **Not to be confused with `AccensaClient`** (above, under "Reading Orders
> and Products"): that client talks to Accensa's own indexer HTTP API to read
> orders/products, and has no concept of a contract at all.
> `ReceiptAnchorClient` talks to a Soroban contract directly over RPC — the
> two are unrelated beyond sharing the same SDK.

```ts
import { ReceiptAnchorClient } from '@accensa/sdk/receipt-anchor-client';

const client = new ReceiptAnchorClient();
const verified = await client.verifyReceiptOnChain(
  1, // batchId
  'c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c', // leaf
  [
    '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1',
    '1733fad16ada0c23d8cdaff52bea66bea308dddddcb79348842acef0065c9615',
  ], // proof
); // true

const batch = await client.getBatch(1); // { root, count, periodStart, periodEnd }
```

With no arguments, `ReceiptAnchorClient` reads the `ReceiptAnchor` instance
Accensa operates on Stellar testnet
([`CBHRJU7C…`](https://stellar.expert/explorer/testnet/contract/CBHRJU7CF4XIFRNDITFHNQHABKBMFM2FYFHLGWN3JGSFYYCDSMDAWPRV)).
This is the right choice for verifying receipts issued by Accensa's own
deployment, which covers most integrations.

### Custom contract initialization

If you have deployed your **own** `ReceiptAnchor` instance — for example to
control anchoring yourself, or because you're running on a network Accensa
doesn't operate on — override `contractId` (and, if it isn't testnet,
`rpcUrl` and `networkPassphrase` to match):

```ts
import { ReceiptAnchorClient } from '@accensa/sdk/receipt-anchor-client';
import { Networks } from '@stellar/stellar-sdk';

const client = new ReceiptAnchorClient({
  // Your own ReceiptAnchor deployment.
  contractId: 'C...',
  // Must be an RPC endpoint for the same network the contract above is
  // deployed on - a mainnet contractId against a testnet rpcUrl (or the
  // reverse) fails simulation with a "contract not found" style error.
  rpcUrl: 'https://soroban-rpc.mainnet.stellar.org',
  networkPassphrase: Networks.PUBLIC,
});

const verified = await client.verifyReceiptOnChain(batchId, leaf, proof);
```

**When to use which:**

|                                                           | Default (`new ReceiptAnchorClient()`)                             | Custom `contractId`                           |
| --------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| Verifying receipts issued by Accensa's hosted deployment  | ✅                                                                | —                                             |
| Verifying receipts from your own `ReceiptAnchor` instance | —                                                                 | ✅                                            |
| RPC endpoint                                              | Accensa's testnet default (`https://soroban-testnet.stellar.org`) | Must point at **your** contract's own network |
| Network passphrase                                        | Testnet default                                                   | Must match `rpcUrl`'s network                 |

Every call `ReceiptAnchorClient` makes is a read-only RPC simulation: nothing
is signed, nothing is submitted, and no transaction fee is paid. That means
verifying a receipt never requires a Stellar account, a wallet, or any trust
in Accensa's servers - only a correctly paired `contractId` and `rpcUrl`.
