import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/wallet';
import { mintSessionCookie } from '../helpers/auth';

/**
 * Checkout coverage without inventing a flow.
 *
 * There is no checkout route. The only checkout surface is the branding live
 * preview (`src/pages/merchant/settings/branding.tsx`), whose `Pay now` button
 * has no handler: it sends no request and produces no receipt. This spec pins
 * the contract that does exist and records the unimplemented authorization and
 * receipt steps as skipped, rather than asserting against a fake API.
 */

async function openBranding(page: Page) {
  const cookie = await mintSessionCookie();
  await page.context().addCookies([
    {
      name: 'accensa_session',
      value: cookie.split(';')[0].split('=')[1],
      url: 'http://127.0.0.1:3000',
    },
  ]);

  const response = await page.goto('/merchant/settings/branding');
  expect(response, 'branding navigation should resolve to an HTTP response').not.toBeNull();
  expect(response!.status()).toBeLessThan(400);
  expect(response!.status()).not.toBe(404);
  return page.getByRole('region', { name: 'Live preview' });
}

test.describe('checkout live preview', () => {
  test('renders the order total and the Pay now control', async ({ page, mockWallet }) => {
    await mockWallet();
    const preview = await openBranding(page);

    await expect(preview).toBeVisible();
    await expect(preview.getByText('Order total')).toBeVisible();
    await expect(preview.getByText('12.50 USDC', { exact: true })).toBeVisible();
    await expect(preview.getByRole('button', { name: 'Pay now' })).toBeVisible();
    await expect(preview.getByTestId('branded-checkout')).toHaveAttribute('data-mode', 'light');
  });

  test('the Light/Dark toggle changes aria-pressed and the wrapper mode', async ({
    page,
    mockWallet,
  }) => {
    await mockWallet();
    const preview = await openBranding(page);
    const toggle = preview.getByRole('group', { name: 'Preview mode' });
    const wrapper = preview.getByTestId('branded-checkout');

    const light = toggle.getByRole('button', { name: 'Light' });
    const dark = toggle.getByRole('button', { name: 'Dark' });
    await expect(light).toHaveAttribute('aria-pressed', 'true');
    await expect(dark).toHaveAttribute('aria-pressed', 'false');

    await dark.click();
    await expect(dark).toHaveAttribute('aria-pressed', 'true');
    await expect(light).toHaveAttribute('aria-pressed', 'false');
    await expect(wrapper).toHaveAttribute('data-mode', 'dark');

    await light.click();
    await expect(light).toHaveAttribute('aria-pressed', 'true');
    await expect(wrapper).toHaveAttribute('data-mode', 'light');
  });

  test('Pay now issues no request from the inert preview', async ({ page, mockWallet }) => {
    await mockWallet();
    const preview = await openBranding(page);
    const pay = preview.getByRole('button', { name: 'Pay now' });
    await expect(pay).toBeVisible();

    const sent: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET' && request.method() !== 'HEAD') {
        sent.push(`${request.method()} ${request.url()}`);
      }
    });

    // The settle is the short waitForRequest timeout: a real authorization
    // would be a non-GET request and would resolve this early as `true`.
    const sawRequest = page
      .waitForRequest((request) => request.method() !== 'GET' && request.method() !== 'HEAD', {
        timeout: 500,
      })
      .then(
        () => true,
        () => false,
      );

    await pay.click();

    expect(await sawRequest).toBe(false);
    expect(sent).toEqual([]);
  });

  // There is no checkout route and no handler on the preview's Pay now button,
  // so neither the wallet authorization step nor a receipt exists to assert.
  test.skip('authorizes the payment with the wallet and shows a receipt', async () => {});
});
