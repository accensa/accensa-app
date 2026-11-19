---
'@accensa/sdk': minor
---

`AccensaClient.fetchOrder` looks orders up directly via `/api/payments?tx_hash=…&limit=1` instead of paging the 1000 most recent orders, so older transactions are found and the lookup no longer transfers a full page.
