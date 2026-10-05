import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };
const tablet = {
  ...devices['Desktop Chrome'],
  viewport: { width: 768, height: 1024 },
  isMobile: true,
  hasTouch: true,
};
const mobile = {
  ...devices['Desktop Chrome'],
  viewport: { width: 375, height: 812 },
  isMobile: true,
  hasTouch: true,
};

/**
 * Visual regression for the merchant dashboard (empty state and payments
 * table), the checkout branding preview, disputes, and the POS terminal.
 * Screenshots are committed under e2e/__screenshots__/<project>.
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
  // One baseline set per project (viewport x colour scheme), no {platform}
  // segment: the baselines are rendered by the ubuntu-latest CI runner, which
  // is the only place they are compared. The tight pixel ratio relies on that
  // single renderer; regenerate them there rather than on a dev machine.
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  updateSnapshots: 'none',
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.005,
      stylePath: './e2e/visual.css',
    },
  },
  // Every project runs in Chromium. The app's CSP sends
  // `upgrade-insecure-requests`, which WebKit applies to the http://127.0.0.1
  // test server (Chromium exempts loopback), so under WebKit the page's CSS and
  // JS are rewritten to https and the screenshots capture a blank or unstyled
  // page. Breakpoints are covered by viewport + touch emulation instead.
  projects: [
    { name: 'mobile-light', use: { ...mobile, colorScheme: 'light' } },
    { name: 'mobile-dark', use: { ...mobile, colorScheme: 'dark' } },
    { name: 'tablet-light', use: { ...tablet, colorScheme: 'light' } },
    { name: 'tablet-dark', use: { ...tablet, colorScheme: 'dark' } },
    { name: 'desktop-light', use: { ...desktop, colorScheme: 'light' } },
    { name: 'desktop-dark', use: { ...desktop, colorScheme: 'dark' } },
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
      NEXT_PUBLIC_STELLAR_NETWORK: 'testnet',
      PORT: String(PORT),
    },
  },
});
