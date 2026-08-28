import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * Visual regression for the merchant dashboard: navbar, empty state, and
 * the payments table. Screenshots are committed under e2e/__screenshots__.
 *
 * A session JWT is minted in the spec so /dashboard is reachable without
 * driving Freighter. /api/payments is intercepted — these tests assert
 * presentation, not the indexer.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    colorScheme: 'light',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      JWT_SECRET_KEY: process.env.JWT_SECRET_KEY ?? 'visual-regression-test-secret',
      MERCHANT_ADDRESS:
        process.env.MERCHANT_ADDRESS ?? 'GCALKSGAZRJLSUEJT3M5W6LN4R7XQOLIRCOS6ZA6EDZVTZDBIIPPFKJ6',
      PORT: String(PORT),
    },
  },
});
