import { test, expect, type Page } from '@playwright/test';
import { mintSessionCookie } from '../helpers/auth';

/**
 * Functional e2e spec for the POS terminal (`src/pages/merchant/pos.tsx`).
 *
 * Source reality (read before writing, per the issue): the page renders a
 * keypad and, on Pay, `handleSubmit` only calls `window.alert(...)` and resets
 * the amount. It makes **no** network request, so there is no stubbed payment
 * response and no paid/failed terminal state. The two paid/failed cases the
 * issue asks for are therefore recorded as skipped, with the reason, rather
 * than faked against an API the page never calls. The page is read-only here.
 *
 * Accessibility gap (reported, not fixed): the amount is a plain `<div>`
 * ("Total Amount" / "$0.00") and the keypad buttons expose only their digit as
 * the accessible name. There is no heading and no labelled input, so this spec
 * navigates by role (button name) and text — the most semantic locators that
 * exist — rather than by a label the page does not provide.
 */

async function openTerminal(page: Page) {
  const cookie = await mintSessionCookie();
  await page.context().addCookies([
    {
      name: 'accensa_session',
      value: cookie.split(';')[0].split('=')[1],
      url: 'http://127.0.0.1:3000',
    },
  ]);
}

test.describe('POS terminal', () => {
  test('an operator reaches the terminal and it renders (never a 404)', async ({ page }) => {
    await openTerminal(page);

    const response = await page.goto('/merchant/pos');

    // A missing route must fail loudly rather than let the rest of the spec
    // pass vacuously against a redirect or error page.
    expect(response, 'POS navigation should resolve to an HTTP response').not.toBeNull();
    expect(response!.status()).toBeLessThan(400);
    expect(response!.status()).not.toBe(404);
    await expect(page).toHaveURL(/\/merchant\/pos$/);
    await expect(page).toHaveTitle('Accensa POS');
    await expect(page.getByText('Total Amount')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pay' })).toBeVisible();
  });

  test('enters an amount, submits it for payment, and resets for the next sale', async ({ page }) => {
    await openTerminal(page);
    await page.goto('/merchant/pos');
    await expect(page.getByText('Total Amount')).toBeVisible();

    await page.getByRole('button', { name: '2' }).click();
    await page.getByRole('button', { name: '5' }).click();
    await expect(page.getByText('$0.25', { exact: true })).toBeVisible();

    // Pay opens a native alert and resets the display; capture the alert text
    // before accepting it so the assertion proves what the operator saw.
    const dialogText = page.waitForEvent('dialog').then(async (dialog) => {
      const message = dialog.message();
      await dialog.accept();
      return message;
    });
    await page.getByRole('button', { name: 'Pay' }).click();

    expect(await dialogText).toBe('Processing payment for $0.25');
    await expect(page.getByText('$0.00', { exact: true })).toBeVisible();
  });

  // From src/pages/merchant/pos.tsx: `handleSubmit` calls only
  // `window.alert(...)`; there is no fetch, no payment API, and no paid or
  // failed state. Both cases below are skipped with the reason instead of
  // being asserted against behaviour that does not exist.
  test.skip('shows the paid state returned by the stubbed payment API', async () => {});
  test.skip('shows the failed state returned by the stubbed payment API', async () => {});
});
