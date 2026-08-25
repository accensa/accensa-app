import { test, expect } from '@playwright/test';
import { SignJWT } from 'jose';

const SECRET = process.env.JWT_SECRET_KEY ?? 'visual-regression-test-secret';
const MERCHANT =
  process.env.MERCHANT_ADDRESS ?? 'GCALKSGAZRJLSUEJT3M5W6LN4R7XQOLIRCOS6ZA6EDZVTZDBIIPPFKJ6';

async function sessionCookie() {
  const token = await new SignJWT({ publicKey: MERCHANT })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(new TextEncoder().encode(SECRET));
  return {
    name: 'accensa_session',
    value: token,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
  };
}

const SAMPLE_PAYMENTS = {
  payments: [
    {
      tx_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ledger: 1001,
      payer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567AAAAAAAAAA',
      amount: '15000000',
      asset: 'native',
      ts: '2026-08-01T12:00:00.000Z',
      route: '/api/resource',
      method: 'GET',
    },
    {
      tx_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ledger: 1002,
      payer: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      amount: '2500000',
      asset: 'native',
      ts: '2026-08-01T12:05:00.000Z',
      route: null,
      method: null,
    },
  ],
  sync: { lastLedger: 1002, updatedAt: '2026-08-01T12:05:00.000Z' },
};

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('navbar on the landing page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('site-nav')).toBeVisible();
  await expect(page.getByTestId('site-nav')).toHaveScreenshot('navbar.png');
});

test('dashboard empty state', async ({ page, context }) => {
  await context.addCookies([await sessionCookie()]);
  await page.route('**/api/payments**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ payments: [], sync: null }),
    });
  });
  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-empty')).toBeVisible();
  await expect(page.getByTestId('dashboard-empty')).toHaveScreenshot('dashboard-empty.png');
});

test('dashboard payments table', async ({ page, context }) => {
  await context.addCookies([await sessionCookie()]);
  await page.route('**/api/payments**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(SAMPLE_PAYMENTS),
    });
  });
  await page.goto('/dashboard');
  await expect(page.getByTestId('payments-table')).toBeVisible();
  await expect(page.getByTestId('payments-table')).toHaveScreenshot('payments-table.png');
});
