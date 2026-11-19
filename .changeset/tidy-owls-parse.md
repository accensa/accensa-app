---
'@accensa/sdk': patch
---

Parse asset codes split by either a colon or a hyphen in `assetSymbol` and `formatPrice`, so Horizon-style identifiers such as `USDC-GA...` render the token symbol instead of the full identifier.
