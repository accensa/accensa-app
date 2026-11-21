import { test, expect, type Page } from '@playwright/test';
import { mintSessionCookie } from './helpers/auth';
import { MOCK_PAYMENTS, mockDashboardApi } from './helpers/mocks';
import { runAxe, type Allowlist } from './helpers/axe';

/**
 * Accessibility gate at the mobile viewport (#792).
 *
 * `a11y.spec.ts` runs under the `chromium` and `firefox` projects, i.e. at
 * Desktop Chrome / Desktop Firefox viewports. The app is not the same page at
 * 375px: `src/app/dashboard/page.tsx:400` renders `PaymentsCardList`, whose root
 * is `md:hidden`, and `page.tsx:407` wraps `PaymentsTable` in `hidden md:block`.
 * The card list repeats the table's information with different semantics — a
 * `role="button"` card with an `aria-label` instead of a row in a table with
 * column scopes — and the table-to-cards swap is exactly the kind of change
 * that drops a header association or duplicates a landmark. Axe at 1440px
 * cannot see any of it.
 *
 * This spec re-runs the four audited routes at 375x812 after asserting that the
 * mobile representation is the one on screen.
 *
 * ## How it is scoped
 *
 * The run is a project, not a separate config: `a11y-mobile` in
 * `playwright.e2e.config.ts` carries the viewport and `testMatch`es this file
 * only, so `pnpm e2e --project=a11y-mobile` runs the mobile pass and nothing
 * else at 375px. The `chromium` and `firefox` projects collect every spec
 * except `visual.spec.ts`, so this file is skipped there by project name —
 * without the guard it would re-run the same assertions at a desktop viewport
 * (and Firefox does not support `isMobile` at all).
 *
 * ## Baseline
 *
 * The allowlist matches `a11y.spec.ts`: the light-theme contrast defect tracked
 * by #190. At 375px the card list adds its own instances of it (the asset label
 * and the field captions are `text-slate-400` on a white card), which are the
 * same defect and the same rule, so one entry covers both. Nothing else on the
 * four routes is allowlisted: a new violation fails the build here as it does
 * on desktop.
 */

const MOBILE_PROJECT = 'a11y-mobile';

const MOBILE_ALLOWLIST: Allowlist = [
  {
    rule: 'color-contrast',
    element: 'dashboard stat cards and the payment card list (light theme)',
    issue: 'https://github.com/accensa/accensa-app/issues/190',
    reason:
      'Secondary text in light mode fails 4.5:1: on the card list the asset label and ' +
      'field captions are text-slate-400 on a white card (~2.6:1). Same defect the desktop ' +
      'gate carries under #190, not a mobile-only finding.',
  },
];

/**
 * Skip this spec outside the `a11y-mobile` project. Called at the top of each
 * test so the file is inert under `chromium` and `firefox` instead of failing
 * there (the mobile assertions cannot hold at a desktop viewport, and Firefox
 * rejects `isMobile`).
 */
function requireMobileProject() {
  test.skip(
    test.info().project.name !== MOBILE_PROJECT,
    `mobile-only spec: run it with \`pnpm e2e --project=${MOBILE_PROJECT}\``,
  );
}

async function mintSession(page: Page) {
  const cookie = await mintSessionCookie();
  await page.context().addCookies([
    {
      name: 'accensa_session',
      value: cookie.split(';')[0].split('=')[1],
      url: 'http://127.0.0.1:3000',
    },
  ]);
}

test.describe('accessibility at the mobile viewport', () => {
  test('/dashboard', async ({ page }) => {
    requireMobileProject();
    await mockDashboardApi(page);
    await mintSession(page);
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: 'Settled Volume' })).toBeVisible();

    // The payments surface has to be the mobile one before axe looks at it.
    // `PaymentsTable` is `hidden md:block`, so it is still in the DOM — finding
    // it is expected; being hidden, and being out of the accessibility tree,
    // is the assertion.
    const table = page.locator('table');
    await expect(table).toHaveCount(1);
    await expect(table).toBeHidden();
    await expect(page.getByRole('table')).toHaveCount(0);

    // And the card list is what replaced it: one accessible button per payment.
    const cards = page.getByRole('button', { name: /view details/i });
    await expect(cards).toHaveCount(MOCK_PAYMENTS.length);
    await expect(cards.first()).toBeVisible();

    await runAxe(page, '/dashboard @ 375x812', MOBILE_ALLOWLIST);
  });

  test('/dashboard/routes', async ({ page }) => {
    requireMobileProject();
    await mockDashboardApi(page);
    await mintSession(page);
    await page.goto('/dashboard/routes');
    await expect(page.getByRole('heading', { name: 'Revenue by Route' })).toBeVisible();

    await runAxe(page, '/dashboard/routes @ 375x812', MOBILE_ALLOWLIST);
  });

  test('/verify', async ({ page }) => {
    requireMobileProject();
    await page.goto('/verify');
    await expect(page.getByText('Verify a Receipt', { exact: false })).toBeVisible();

    await runAxe(page, '/verify @ 375x812', MOBILE_ALLOWLIST);
  });

  test('/login', async ({ page }) => {
    requireMobileProject();
    await page.goto('/login');
    await expect(page.getByText('Merchant Login')).toBeVisible();

    await runAxe(page, '/login @ 375x812', MOBILE_ALLOWLIST);
  });
});
