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
  // This config drives the visual-regression suite only. The flow and
  // accessibility specs are exercised by playwright.e2e.config.ts (they run
  // against port 3000 with their own session/network mocking); running them
  // here would hit the wrong port and fail.
  testMatch: '**/visual.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    colorScheme: 'light',
  },
  // Platform-independent snapshot paths (no {platform}/{projectName}) so the
  // same committed PNGs are compared on every OS CI runs on. A pixel ratio
  // tolerance absorbs cross-OS font rasterization differences while the
  // screenshots still catch layout regressions. 0.04 comfortably covers the
  // Windows-vs-Linux rendering delta (~2% observed for the navbar) with ~2x
  // headroom, whereas a real layout regression produces a much larger diff.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.04,
    },
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
