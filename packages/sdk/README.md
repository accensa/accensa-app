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
