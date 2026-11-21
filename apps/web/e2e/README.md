# Visual regression

Playwright screenshots of the merchant dashboard and the screens that sit
beside it. Each baseline below is captured by `visual.spec.ts`, and the name in
backticks is the file in `e2e/__screenshots__/` that will change when the
screen does:

- `dashboard-empty.png` — the dashboard before any payment has arrived
  ("Awaiting Data")
- `dashboard-payments.png` — the dashboard with a populated payments table
- `checkout-modal.png` — the checkout modal in the branding page's live preview
- `dispute-flow.png` — the merchant disputes page
- `pos-terminal.png` — the point-of-sale terminal

```bash
pnpm --filter web test:visual          # compare against committed snapshots
pnpm --filter web test:visual:update   # rewrite snapshots after an intentional UI change
```

`tests/e2e-readme.test.mjs` fails when this list and the `toHaveScreenshot()`
calls disagree, so adding or removing a baseline means editing both.

The suite mints a session JWT (`JWT_SECRET_KEY`, defaulting to the same value
CI uses) and intercepts `/api/payments`. It does not talk to PostgreSQL or
Stellar. Snapshots live in `e2e/__screenshots__/`.
