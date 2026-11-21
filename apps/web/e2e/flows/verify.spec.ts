import { test, expect } from '@playwright/test';
import {
  MOCK_VERIFY_BATCH,
  MOCK_VERIFY_DISAGREEMENT,
  MOCK_VERIFY_FORGED,
  MOCK_VERIFY_VALID,
  mockVerifyApi,
} from '../helpers/mocks';

/**
 * `/verify` is the only public page whose output is a security verdict, and
 * before this spec the browser suite only loaded it (`e2e/a11y.spec.ts`) — the
 * form was never submitted. Everything below answers `POST /api/verify` from
 * `e2e/helpers/mocks.ts`, so no database, RPC node or rate limiter is involved.
 *
 * The two samples are the page's own constants (`src/app/verify/page.tsx:18`
 * and `:25`), and the request body mirrors what `submit()` sends there:
 * `batchId` as a number, `leaf` trimmed, `proof` split on whitespace/commas.
 */

const VALID_SAMPLE = {
  batchId: 1,
  leaf: 'c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c',
  proof: [
    '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1',
    '1733fad16ada0c23d8cdaff52bea66bea308dddddcb79348842acef0065c9615',
  ],
};

const FORGED_LEAF = '16b138aabc889c21114436424e13132bd8928d2c21b4ac5a9ac5198104efb42c';

const verdict = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: 'Verification verdict' });

const submit = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Verify Cryptographic Proof' }).click();

test.describe('verify', () => {
  test('a valid triple is verified and the verdict takes focus', async ({ page }) => {
    await mockVerifyApi(page, MOCK_VERIFY_VALID);
    await page.goto('/verify');

    // The sample button fills the form; asserting the fields proves the body
    // below is what the page actually holds, not just what we expect to send.
    await page.getByRole('button', { name: 'Valid Sample' }).click();
    await expect(page.getByLabel(/Batch ID/)).toHaveValue(String(VALID_SAMPLE.batchId));
    await expect(page.getByLabel(/Receipt Hash/)).toHaveValue(VALID_SAMPLE.leaf);

    const request = page.waitForRequest('**/api/verify');
    await submit(page);

    expect((await request).postDataJSON()).toEqual(VALID_SAMPLE);

    await expect(verdict(page)).toBeFocused();
    await expect(page.getByRole('heading', { name: /Proof Verified/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Proof Rejected/ })).toHaveCount(0);
    // The anchored batch the route reports is rendered alongside the verdict.
    await expect(page.getByText('Anchored Batch Metadata')).toBeVisible();
    await expect(page.getByText(MOCK_VERIFY_BATCH.root)).toBeVisible();
  });

  test('a forged leaf is rejected', async ({ page }) => {
    await mockVerifyApi(page, MOCK_VERIFY_FORGED);
    await page.goto('/verify');

    await page.getByRole('button', { name: 'Forged Sample' }).click();
    await expect(page.getByLabel(/Receipt Hash/)).toHaveValue(FORGED_LEAF);

    const request = page.waitForRequest('**/api/verify');
    await submit(page);

    expect((await request).postDataJSON()).toEqual({ ...VALID_SAMPLE, leaf: FORGED_LEAF });

    await expect(page.getByRole('heading', { name: /Proof Rejected/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Proof Verified/ })).toHaveCount(0);
  });

  test('a disagreement between the two checks never verifies', async ({ page }) => {
    await mockVerifyApi(page, MOCK_VERIFY_DISAGREEMENT);
    await page.goto('/verify');

    await page.getByRole('button', { name: 'Valid Sample' }).click();
    await submit(page);

    // `verified` is true only when both checks agree; a disagreement is shown
    // as rejected even though the local recomputation passed.
    await expect(page.getByRole('heading', { name: /Proof Rejected/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Proof Verified/ })).toHaveCount(0);
    await expect(page.getByText('Local Compute')).toBeVisible();
    await expect(page.getByText('Ledger Contract')).toBeVisible();
    await expect(page.getByText('Valid', { exact: true })).toBeVisible();
    await expect(page.getByText('Failed', { exact: true })).toBeVisible();
  });
});
