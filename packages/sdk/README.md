# `@accensa/sdk`

This SDK enables merchant applications to report x402 payment settlements to an Accensa indexer.

## Reporting Settlements

Accensa supports merchant-reported route attribution via the `/api/hook/settle` webhook.

To maintain integrity, the payload is authenticated. Sellers using `@accensa/sdk` will have this handled automatically via `createSettleHook` or `attachAccensaHook`.

Signing uses WebCrypto Ed25519 when `globalThis.crypto.subtle` supports it, and falls back to Node.js `crypto` otherwise. The SDK is supported and tested on Node.js, Vercel Edge Functions, Cloudflare Workers, and Deno Deploy. Runtimes without either WebCrypto Ed25519 or Node.js crypto fail loudly rather than sending an unsigned report.

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
