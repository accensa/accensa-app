# `@accensa/sdk`

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
| `AccensaNetworkError`  | The indexer could not be reached — `fetch` failed, timed out, or is unavailable.                            | `url`, `cause`   |
| `AccensaContractError` | The indexer (or a receipt) violated the wire contract: a malformed row, a non-JSON body, a bad Merkle hash. | `index`          |
| `AccensaError`         | The base class; also thrown directly for other non-2xx statuses (e.g. 500).                                 | `status`         |

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
