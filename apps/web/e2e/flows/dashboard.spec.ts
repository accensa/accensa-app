import { test, expect, type Page } from '@playwright/test';
import { mintSessionCookie } from '../helpers/auth';
import {
  MOCK_PAYMENTS,
  mockDashboardApi,
  mockDashboardApiEmpty,
  mockDashboardApiError,
} from '../helpers/mocks';

async function openDashboard(page: Page) {
  await page.context().addCookies([
    {
      name: 'accensa_session',
      value: (await mintSessionCookie()).split(';')[0].split('=')[1],
      url: 'http://127.0.0.1:3000',
    },
  ]);
}

test.describe('dashboard', () => {
  test('loads and renders payments', async ({ page }) => {
    await mockDashboardApi(page);
    await openDashboard(page);
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: 'Settled Volume' })).toBeVisible();
    // Total settled reflects the mocked fixtures (10.00 + 5.50).
    await expect(page.getByText('15.50')).toBeVisible();
    // Both payment assets render in the desktop table. Scoped to the table so
    // we don't match the hidden mobile card-list span.
    const table = page.locator('table');
    await expect(table.getByText('USDC')).toBeVisible();
    await expect(table.getByText('XLM')).toBeVisible();
    // The table caption / heading is present.
    await expect(page.getByRole('heading', { name: 'Recent Settlements' })).toBeVisible();
  });

  test('opens and closes a payment details modal', async ({ page }) => {
    await mockDashboardApi(page);
    await openDashboard(page);
    await page.goto('/dashboard');

    // Open the first payment row (desktop table row).
    const row = page.locator('tr', { hasText: MOCK_PAYMENTS[0].amount }).first();
    await row.click();

    const modal = page.getByText('Payment Details');
    await expect(modal).toBeVisible();
    await expect(page.getByText('Transaction Hash')).toBeVisible();

    // Close via the close button.
    await page.getByRole('button', { name: 'Close payment details' }).click();
    await expect(modal).not.toBeVisible();
  });

  test('shows the empty state when there are no payments', async ({ page }) => {
    await mockDashboardApiEmpty(page);
    await openDashboard(page);
    await page.goto('/dashboard');

    await expect(page.getByText('Awaiting Data')).toBeVisible();
    await expect(page.getByText(/Payments settled to this merchant address/)).toBeVisible();
    // Export is disabled with nothing to export.
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });

  test('shows the error state when the API fails', async ({ page }) => {
    await mockDashboardApiError(page);
    await openDashboard(page);
    await page.goto('/dashboard');

    await expect(page.getByText('Connection Error')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
  });

  test('CSV export triggers a download', async ({ page }) => {
    await mockDashboardApi(page);
    await openDashboard(page);
    await page.goto('/dashboard');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^accensa_payments_.*\.csv$/);
  });

  test('sync button enters cooldown after a sync attempt', async ({ page }) => {
    await mockDashboardApi(page);
    await openDashboard(page);
    await page.goto('/dashboard');

    const syncButton = page.getByRole('button', { name: 'Sync now' });
    await expect(syncButton).toBeVisible();

    // The mocked /api/sync POST returns 429 with a 60s cooldown.
    await syncButton.click();
    const waitButton = page.getByRole('button', { name: /Wait \d+s/ });
    await expect(waitButton).toBeVisible();
    await expect(waitButton).toBeDisabled();
  });
});

test.describe('dashboard routes', () => {
  test('loads the revenue-by-route page', async ({ page }) => {
    await mockDashboardApi(page);
    await openDashboard(page);
    await page.goto('/dashboard/routes');

    await expect(page.getByRole('heading', { name: 'Revenue by Route' })).toBeVisible();
  });
});

test.describe('auth', () => {
  test('login page renders and requires a wallet', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Merchant Login' })).toBeVisible();
    // No wallet in the test browser; connecting leads to an error state.
    const connect = page.getByRole('button', { name: 'Connect Wallet' });
    await connect.click();
    await expect(page.getByRole('alert')).toBeVisible();
  });
});

test.describe('verify', () => {
  test('verify page accepts hex proof input', async ({ page }) => {
    await page.goto('/verify');
    await expect(page.getByRole('heading', { name: 'Verify a Receipt' })).toBeVisible();
    await expect(page.getByLabel(/Batch/)).toBeVisible();
    await expect(page.getByPlaceholder(/c476fc05/)).toBeVisible();
  });
});
