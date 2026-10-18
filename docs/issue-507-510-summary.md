# Issue 507-510 verification summary

This note records the verification and issue linkage for the four upstream bugs assigned to `honourableking`:

- Closes #507
- Closes #508
- Closes #509
- Closes #510

The current workspace already contains the corresponding fixes for:

- the advisory lock being taken outside the transaction boundary,
- the forced row-level-security scoping bug in the anchoring path,
- the revenue aggregation bug in the routes endpoint,
- and the client-side fetches that were hitting missing API routes.

The upstream assignments are confirmed against the live GitHub metadata for `accensa/accensa-app`.
