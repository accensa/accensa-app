import type { Page } from '@playwright/test';

/**
 * Backend state for the e2e harness is supplied at the network layer: every
 * API route the dashboard touches is intercepted and answered with fixed,
 * deterministic fixtures. No database is required and no seeded state is
 * consulted, so the suite is fast and fully repeatable.
 *
 * The choice (network mocking over a seeded test database) is deliberate:
 * - it keeps CI free of a PostgreSQL service dependency for browser tests;
 * - the six flows below only need a handful of stable responses;
 * - it is easy to reverse — delete the `route` registrations and point the
 *   app at a real database to get integration coverage.
 */

export interface MockPayment {
  tx_hash: string;
  ledger: number;
  payer: string;
  amount: string;
  asset: string;
  ts: string;
  route: string;
  method: string;
}

export const MOCK_PAYMENTS: MockPayment[] = [
  {
    tx_hash: 'a'.repeat(64),
    ledger: 1234,
    payer: 'GA'.padEnd(56, 'A'),
    amount: '10.00',
    asset: 'USDC',
    ts: '2026-08-01T10:00:00.000Z',
    route: '/api/pay',
    method: 'POST',
  },
  {
    tx_hash: 'b'.repeat(64),
    ledger: 1233,
    payer: 'GB'.padEnd(56, 'B'),
    amount: '5.50',
    asset: 'XLM',
    ts: '2026-08-01T09:30:00.000Z',
    route: '/api/quote',
    method: 'GET',
  },
];

export function paymentsResponse(payments: MockPayment[] = MOCK_PAYMENTS) {
  return {
    payments,
    total_count: payments.length,
    total_amount: payments.reduce((sum, p) => sum + Number.parseFloat(p.amount), 0).toFixed(2),
    sync: {
      level: 'live',
      age: 0,
      detail: 'Indexer up to date',
    },
  };
}

/**
 * Intercepts every API route the dashboard reads so the app renders
 * deterministically with the fixtures above.
 */
export async function mockDashboardApi(page: Page, payments: MockPayment[] = MOCK_PAYMENTS) {
  await page.route('**/api/payments', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(paymentsResponse(payments)),
    });
  });

  await page.route('**/api/payments?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(paymentsResponse(payments)),
    });
  });

  await page.route('**/api/sync', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'cooldown', retryAfterMs: 60_000 }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

/** An error state: /api/payments returns a 500. */
export async function mockDashboardApiError(page: Page) {
  await page.route('**/api/payments**', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'boom' }),
    });
  });
}

/** An empty state: /api/payments returns zero payments. */
export async function mockDashboardApiEmpty(page: Page) {
  await page.route('**/api/payments**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(paymentsResponse([])),
    });
  });
}
