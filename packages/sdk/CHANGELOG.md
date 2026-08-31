# @accensa/sdk

## 0.1.0

### Initial published release

First publishable release of `@accensa/sdk`. This is the same API that has been
consumed internally via `workspace:^`; no breaking changes from the workspace
version.

#### Added

- **Build pipeline:** tsup emits ESM (`.mjs`), CJS (`.js`), and `.d.ts` to
  `dist/`. Consumers need no TypeScript config.
- **Package metadata:** `exports` map, `files` whitelist, `sideEffects: false`,
  repository and bugs URLs.
- **Package README:** documents `verifyReceipt`, `attachAccensaHook`,
  `createSettleHook`, the signing contract, and supported runtimes.

#### Note

The report payload (`SettleHookPayload`) and Ed25519 signature scheme are a
**wire contract** with sellers. Any change to the payload fields or signing
mechanism is a breaking change and will be released as a major version bump.
