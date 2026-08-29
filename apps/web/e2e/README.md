# Visual regression

Playwright screenshots of the merchant dashboard:

- landing-page navbar
- dashboard empty state
- payments table (populated)

```bash
pnpm --filter web test:visual          # compare against committed snapshots
pnpm --filter web test:visual:update   # rewrite snapshots after an intentional UI change
```

The suite mints a session JWT (`JWT_SECRET_KEY`, defaulting to the same value
CI uses) and intercepts `/api/payments`. It does not talk to PostgreSQL or
Stellar. Snapshots live in `e2e/__screenshots__/`.
