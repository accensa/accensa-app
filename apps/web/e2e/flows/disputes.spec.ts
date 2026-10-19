import { Buffer } from 'node:buffer';
import { test, expect, type Page } from '@playwright/test';
import { mintSessionCookie } from '../helpers/auth';

/**
 * Functional e2e spec for the merchant dispute flow
 * (`src/pages/merchant/disputes/index.tsx` and `[id].tsx`).
 *
 * Three gaps between the issue's description and main are recorded as
 * skipped with the reason rather than faked:
 *
 * - `index.tsx` hardcodes `const pendingDisputes: PendingDispute[] = []`, so
 *   the list is always empty and renders no links. "At least two disputes with
 *   distinct ids" and clicking a link into `[id]` cannot be exercised. The
 *   detail route is covered directly instead.
 * - `[id].tsx` no longer composes `EvidenceUpload`: PR #688 removed the
 *   component and its page wiring because it posted to
 *   `/api/disputes/<id>/evidence`, an API route that does not exist (issue
 *   #510). The evidence-upload test below is skipped for that reason.
 * - `DisputeChat` exists (`apps/web/components/disputes/DisputeChat.tsx`) but
 *   is not rendered by any page, so there is no message input to post from.
 *
 * Accessibility note (recorded while `EvidenceUpload` still existed): its
 * `<input type="file">` was `sr-only` with no label or `aria-label`, which is
 * why the skipped evidence test scopes to the upload section and its
 * `input[type=file]` rather than a labelled control.
 */

// A 1x1 transparent PNG, built in memory so no fixture file is added. The
// component validates only MIME type (PDF/JPG/PNG) and size (<= 10 MB).
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function openDisputes(page: Page) {
  const cookie = await mintSessionCookie();
  await page.context().addCookies([
    {
      name: 'accensa_session',
      value: cookie.split(';')[0].split('=')[1],
      url: 'http://127.0.0.1:3000',
    },
  ]);
}

// The detail page does not currently open the chat stream, but the issue asks
// that it be stubbed or ended immediately so a future wiring cannot hang the
// test. Fulfilling it with an empty body ends it at once.
async function stubDisputeChat(page: Page) {
  await page.route('**/api/disputes/**/messages', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ message: {} }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ salt: '', messages: [] }),
    });
  });
  await page.route('**/api/disputes/**/messages/stream', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }),
  );
}

test.describe('dispute flow', () => {
  test('an operator sees the pending-disputes list and both urgency windows', async ({ page }) => {
    await openDisputes(page);

    const response = await page.goto('/merchant/disputes');

    expect(response, 'disputes navigation should resolve to an HTTP response').not.toBeNull();
    expect(response!.status()).toBeLessThan(400);
    expect(response!.status()).not.toBe(404);
    await expect(page).toHaveURL(/\/merchant\/disputes$/);
    await expect(page.getByRole('heading', { name: 'Pending disputes' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Urgent, less than 24 hours' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Open, more than 24 hours' })).toBeVisible();
    // The list is hardcoded empty on main, so this is the real current state.
    await expect(page.getByText('No pending disputes in this window.')).toHaveCount(2);
  });

  test('opens the dispute detail named by the route and shows that dispute id', async ({
    page,
  }) => {
    await stubDisputeChat(page);
    await openDisputes(page);

    const response = await page.goto('/merchant/disputes/DSP-2002');

    expect(response, 'dispute detail should resolve to an HTTP response').not.toBeNull();
    expect(response!.status()).toBeLessThan(400);
    expect(response!.status()).not.toBe(404);
    await expect(page).toHaveURL(/\/merchant\/disputes\/DSP-2002$/);
    await expect(page.getByRole('heading', { name: 'Review customer dispute' })).toBeVisible();
    await expect(page.getByText('Dispute DSP-2002')).toBeVisible();
    // Scoped to the id in the URL, not a shared placeholder: the other
    // dispute's id must not appear anywhere on the page.
    await expect(page.getByText('Dispute DSP-1001')).toHaveCount(0);
  });

  // Skipped, not deleted: the component this test drove (`EvidenceUpload`) and
  // its page wiring were removed by PR #688 because the endpoint it posted to
  // (`/api/disputes/<id>/evidence`) never existed (issue #510). Re-enabling
  // means restoring that API first; the body below documents the intended
  // interaction until then.
  test.skip('attaches evidence to a dispute and the UI shows the uploaded state', async ({
    page,
  }) => {
    await page.route('**/api/disputes/**/evidence', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ cid: 'bafy-test-cid' }),
      }),
    );
    await stubDisputeChat(page);
    await openDisputes(page);
    await page.goto('/merchant/disputes/DSP-2002');

    const upload = page.locator('section[aria-labelledby="evidence-upload-heading"]');
    await expect(upload.getByRole('heading', { name: 'Counter-evidence' })).toBeVisible();
    await expect(upload.getByRole('button', { name: 'Choose evidence' })).toBeVisible();
    // Nothing claims success until the stubbed upload resolves.
    await expect(page.getByText('Evidence pinned successfully.')).toHaveCount(0);

    await upload.locator('input[type="file"]').setInputFiles({
      name: 'receipt.png',
      mimeType: 'image/png',
      buffer: PNG_BYTES,
    });

    await expect(page.getByText('Evidence pinned successfully.')).toBeVisible();
  });

  // src/pages/merchant/disputes/index.tsx hardcodes `pendingDisputes = []`, so
  // the list renders no rows and no "Review dispute" links. The list-to-detail
  // navigation the issue describes cannot be exercised.
  test.skip('links at least two distinct disputes into their detail routes', async () => {});

  // src/pages/merchant/disputes/[id].tsx renders neither EvidenceUpload nor
  // DisputeChat, and no page renders DisputeChat, so there is no message field
  // or send button to post from. The chat backend exists but has no UI wired
  // to these pages.
  test.skip('posts a merchant message and clears the input', async () => {});
});
