# `@accensa/sdk`

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
