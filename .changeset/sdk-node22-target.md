---
'@accensa/sdk': major
---

Build the SDK for Node 22 instead of Node 18.

The `tsup.config.ts` `target` is now `'node22'` and `package.json` declares
`"engines": { "node": ">=22" }`.

**Breaking change**: Node 18 and Node 20 are no longer supported. The SDK
requires Node 22 or later, matching the runtime documented in README.md and
pinned across all workflows.
