---
'@accensa/sdk': minor
---

Derive the `/api/hook/settle` wire types from the OpenAPI spec, and fail loudly
on an undecodable `ReceiptAnchor` batch.

- `SettleHookPayload` is now an alias of the spec's `SettlementReport` (via the
  new `@accensa/sdk/api` layer) instead of a hand-declared copy, so a change to
  `apps/web/openapi.yaml` reaches the SDK rather than drifting from it. One
  consequence for TypeScript consumers: `payload.method` is the spec's seven-method
  union rather than `string`, and `toSettleHookPayload` normalizes case before
  reporting rather than forwarding it verbatim.
- A settlement whose method is outside that union is now rejected locally with an
  `AccensaContractError` through `onError` (and `reportSettlement` still resolves
  `false`), instead of being signed, sent, and answered with a 400. `toSettleReportError`
  passes an existing `AccensaError` through instead of relabelling it a network failure.
- `registerReceiptAnchorAbi` returns a disposer, so a registration made by a test or a
  re-configuring server can be scoped instead of leaking into every later lookup.
- `ReceiptAnchorAbiError` (with a `code` of `unknown_version`, `undecodable_root`, or
  `undecodable_number`) replaces the bare `Error`s the ABI registry threw. A batch root
  that is not hex and a count that does not decode to a finite integer are now errors
  rather than a bad root or a `NaN` that travels. Hex encoding no longer depends on
  Node's `Buffer`, so the registry works in a browser or React Native as its
  documentation claims.
