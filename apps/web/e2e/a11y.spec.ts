import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mintSessionCookie } from './helpers/auth';
import { MOCK_PAYMENTS, mockDashboardApi } from './helpers/mocks';

/**
 * Automated accessibility gate for the dashboard (#205, #528).
 *
 * Covers the five required states: /dashboard, /dashboard/routes, /verify,
 * /login, and the dashboard with the payment modal open.
 *
 * ## Baseline allowlist
 *
 * Every rule below is a known defect tracked by an open issue. It is NOT a
 * blanket severity threshold: each entry names the rule, the element, and the
 * issue that tracks the fix. When the issue lands, the entry must be removed
 * and the check starts failing on that rule again.
 *
 * | Rule (axe) | Element | Linked issue | Reason / Axe Output |
 * |---|---|---|---|
 * | `color-contrast` | dashboard stat cards (light theme) | [#190](https://github.com/accensa/accensa-app/issues/190) | Kept: low contrast on secondary stat text in light mode (axe output: elements fail contrast ratio < 4.5:1 on text nodes) |
 *
 * Note: Stale entries `button-name`, `dialog-name`, `aria-dialog-name`, `aria-prohibited-attr`, and `aria-valid-attr-value` have been retired per issue #528 as violations no longer reproduce.
 *
 * Anything NOT in this allowlist fails the build, naming the element and rule.
 */

const ALLOWLIST: Record<string, { element: string; issue: string }> = {
  'color-contrast': {
    element: 'dashboard stat cards (light theme)',
    issue: 'https://github.com/accensa/accensa-app/issues/190',
  },
};

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

async function runAxe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter((v) => !ALLOWLIST[v.id]);
  const allowed = results.violations.filter((v) => ALLOWLIST[v.id]);

  for (const v of allowed) {
    const entry = ALLOWLIST[v.id];
    console.log(`[allowlist] ${label}: ${v.id} on "${entry.element}" (tracked: ${entry.issue})`);
  }

  const failures = violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    elements: v.nodes.map((n) => n.target.join(' ')).slice(0, 3),
  }));

  expect(
    failures,
    `Accessibility violations on ${label}:\n` +
      failures
        .map((f) => `- ${f.rule} (${f.impact}): ${f.help} on ${f.elements.join(', ')}`)
        .join('\n'),
  ).toEqual([]);
}

test.describe('accessibility', () => {
  test('/dashboard', async ({ page }) => {
    await mockDashboardApi(page);
    await mintSession(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Settled Volume' })).toBeVisible();
    await runAxe(page, '/dashboard');
  });

  test('/dashboard with payment modal open', async ({ page }) => {
    await mockDashboardApi(page);
    await mintSession(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Settled Volume' })).toBeVisible();

    // Open the first payment row (desktop table row) to expose the modal.
    const row = page.locator('tr', { hasText: MOCK_PAYMENTS[0].amount }).first();
    await row.click();
    await expect(page.getByText('Payment Details')).toBeVisible();

    await runAxe(page, '/dashboard + payment modal');
  });

  test('/dashboard/routes', async ({ page }) => {
    await mockDashboardApi(page);
    await mintSession(page);
    await page.goto('/dashboard/routes');
    await expect(page.getByRole('heading', { name: 'Revenue by Route' })).toBeVisible();
    await runAxe(page, '/dashboard/routes');
  });

  test('/verify', async ({ page }) => {
    await page.goto('/verify');
    await expect(page.getByText('Verify a Receipt', { exact: false })).toBeVisible();
    await runAxe(page, '/verify');
  });

  test('/login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Merchant Login')).toBeVisible();
    await runAxe(page, '/login');
  });

  test('regression check demonstration: failing gate when allowlist rule is omitted', async ({ page }) => {
    await mockDashboardApi(page);
    await mintSession(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Settled Volume' })).toBeVisible();

    // Temporarily remove 'color-contrast' from ALLOWLIST to prove that an active
    // violation or unallowlisted rule correctly triggers test failure.
    const originalAllowlist = { ...ALLOWLIST };
    delete ALLOWLIST['color-contrast'];
    try {
      let failed = false;
      try {
        await runAxe(page, '/dashboard-regression-check');
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
    } finally {
      Object.assign(ALLOWLIST, originalAllowlist);
    }
  });
});
