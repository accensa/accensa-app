import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end harness for apps/web (#202).
 *
 * Runs against a production build (`next build` + `next start`) served on
 * http://127.0.0.1:3000. Backend state is supplied deterministically by
 * intercepting `/api/payments` (and friends) at the network layer — no
 * database, no seeded state, fully repeatable.
 *
 * The config is deliberately named `playwright.e2e.config.ts` (not
 * `playwright.config.ts`) so it can coexist with the visual-regression
 * Playwright setup in PR #35/#238 without either stomping the other's default
 * config file.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // `next dev` rather than a production build: the app's API routes are
    // type-checked lazily per request, and the e2e specs intercept every API
    // route they touch at the network layer, so the harness is immune to the
    // pre-existing `getMaxBatchSize` build break on main (see
    // apps/web/src/app/api/payments/route.ts). The same interception makes
    // backend state fully deterministic without a database.
    command: 'pnpm dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      JWT_SECRET_KEY: 'playwright-e2e-secret-key',
      MERCHANT_ADDRESS: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/accensa_e2e_none',
    },
  },
});