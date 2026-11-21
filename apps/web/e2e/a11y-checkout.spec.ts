import { test, expect, type Page } from '@playwright/test';
import { mintSessionCookie } from './helpers/auth';
import { runAxe, type Allowlist } from './helpers/axe';

/**
 * Accessibility gate for the payer- and merchant-facing checkout surfaces (#791).
 *
 * `e2e/a11y.spec.ts` covers `/dashboard`, `/dashboard/routes`, `/verify` and
 * `/login` and stops there. The two surfaces a merchant configuring a checkout
 * actually touches are never scanned:
 *
 *  - `/merchant/settings/branding` — the checkout branding editor, whose
 *    `section[aria-label="Live preview"]` renders the real branded checkout in
 *    both light and dark mode. `e2e/visual.spec.ts` already drives this URL.
 *  - `/merchant/pos` — the POS terminal. `e2e/flows/pos.spec.ts` documents why
 *    it is the weakest page in the app: the amount is a plain `<div>`, the
 *    keypad exposes only its digit as the accessible name, and there is no
 *    heading and no labelled input.
 *
 * Both routes are scanned here with the same runner the other gate uses
 * (`./helpers/axe`), after asserting the surface actually rendered — axe over a
 * half-rendered page reports phantom violations from the loading state.
 *
 * ## Baseline
 *
 * The entries below record defects that are real in the current DOM and cannot
 * be fixed inside this issue's file ownership (`src/pages/merchant/**` belongs
 * to the page owners; see the "File ownership" section of #791). Each one is
 * referenced to #791, which is where this gate reports them; when a follow-up
 * application issue exists, re-point the entries at it. Nothing here raises an
 * impact threshold or disables a rule: a violation that is not listed fails the
 * build with its rule id, impact and up to three element targets.
 *
 * The POS allowlist is larger than the branding one because the terminal has no
 * landmark, no heading and a viewport that disables zoom — the accessibility
 * debt `flows/pos.spec.ts` recorded when it had to navigate by button name.
 */

/** Defects shared by every route served by the Pages Router under `/merchant`. */
const PAGES_ROUTER_ALLOWLIST: Allowlist = [
  {
    rule: 'html-has-lang',
    element: 'document root of the /merchant/* routes',
    issue: 'https://github.com/accensa/accensa-app/issues/791',
    reason:
      'The Pages Router document has no lang attribute. The App Router root layout sets ' +
      'lang="en", but /merchant/* is served by src/pages and inherits the default document. ' +
      'Fixing it needs a src/pages/_document.tsx, which is outside this issue.',
  },
  {
    rule: 'landmark-one-main',
    element: 'page shell of the /merchant/* routes',
    issue: 'https://github.com/accensa/accensa-app/issues/791',
    reason:
      'The page renders its content in plain divs, so there is no <main> landmark for a ' +
      'screen reader to jump to. The pages themselves own this fix.',
  },
  {
    rule: 'region',
    element: 'content outside the banner landmark on the /merchant/* routes',
    issue: 'https://github.com/accensa/accensa-app/issues/791',
    reason:
      'Same cause as landmark-one-main: with no main/contentinfo landmark, axe reports the ' +
      'form and preview section (branding) or the terminal card (POS) as uncontained.',
  },
];

/** The branding editor: structurally sound, but still Pages Router and landmark-free. */
const BRANDING_ALLOWLIST: Allowlist = [
  ...PAGES_ROUTER_ALLOWLIST,
  {
    rule: 'color-contrast',
    element: 'live checkout preview header in light mode',
    issue: 'https://github.com/accensa/accensa-app/issues/791',
    reason:
      'The light mode preview container has text contrast below 4.5:1 on styled elements.',
  },
];

/**
 * The POS terminal. `/merchant/pos` has a `<title>` and a set of named buttons,
 * but no heading, no landmark and `user-scalable=0` in its viewport meta, so
 * the three structural findings above are joined by the four below.
 */
const POS_ALLOWLIST: Allowlist = [
  ...PAGES_ROUTER_ALLOWLIST,
  {
    rule: 'page-has-heading-one',
    element: 'POS terminal card',
    issue: 'https://github.com/accensa/accensa-app/issues/791',
    reason:
      'The terminal has no heading of any level: "Total Amount" is a styled div, so the ' +
      'amount and the keypad have nothing to be announced under.',
  },
  {
    rule: 'bypass',
    element: 'POS terminal page',
    issue: 'https://github.com/accensa/accensa-app/issues/791',
    reason:
      'WCAG 2.4.1 needs a skip link, a heading or a landmark. The page has none of the ' +
      'three, so there is no way past the keypad other than tabbing through it.',
  },
  {
    rule: 'meta-viewport',
    element: '<meta name="viewport"> in src/pages/merchant/pos.tsx',
    issue: 'https://github.com/accensa/accensa-app/issues/791',
    reason:
      'The viewport meta sets maximum-scale=1 and user-scalable=0, which blocks pinch zoom ' +
      '(WCAG 1.4.4) on the surface where an operator is most likely to need it.',
  },
  {
    rule: 'meta-viewport-large',
    element: '<meta name="viewport"> in src/pages/merchant/pos.tsx',
    issue: 'https://github.com/accensa/accensa-app/issues/791',
    reason:
      'Same tag: maximum-scale=1 caps magnification well below the 200% the rule requires, ' +
      'so the terminal cannot be zoomed to a readable size on a small handheld screen.',
  },
];

/** Mint the `accensa_session` cookie the same way `a11y.spec.ts` and `flows/pos.spec.ts` do. */
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

/** The live preview inside the branding editor. */
function livePreview(page: Page) {
  return page.locator('section[aria-label="Live preview"]');
}

test.describe('checkout accessibility', () => {
  test('/merchant/settings/branding — light mode', async ({ page }) => {
    await mintSession(page);
    await page.goto('/merchant/settings/branding');

    // Prove the surface rendered before axe looks at it: the editor heading,
    // the preview section and the preview's own checkout heading.
    await expect(page.getByRole('heading', { name: 'Checkout Branding' })).toBeVisible();
    await expect(livePreview(page)).toBeVisible();
    await expect(
      livePreview(page).getByRole('heading', { name: 'Complete your payment' }),
    ).toBeVisible();
    await expect(page.getByTestId('branded-checkout')).toHaveAttribute('data-mode', 'light');

    await runAxe(page, '/merchant/settings/branding (light)', BRANDING_ALLOWLIST);
  });

  test('/merchant/settings/branding — dark mode', async ({ page }) => {
    await mintSession(page);
    await page.goto('/merchant/settings/branding');
    await expect(livePreview(page)).toBeVisible();

    // The mode toggle changes the colour pairs under test — dark mode swaps the
    // preview background and re-derives the accent — so it needs its own pass.
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await expect(page.getByTestId('branded-checkout')).toHaveAttribute('data-mode', 'dark');
    await expect(page.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await runAxe(page, '/merchant/settings/branding (dark)', BRANDING_ALLOWLIST);
  });

  test('/merchant/pos', async ({ page }) => {
    await mintSession(page);
    const response = await page.goto('/merchant/pos');

    // A redirect to /login would still render a page for axe to scan, and a
    // clean result on the login form would report nothing about the terminal.
    expect(response, 'POS navigation should resolve to an HTTP response').not.toBeNull();
    expect(response!.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/merchant\/pos$/);

    await expect(page.getByText('Total Amount')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pay' })).toBeVisible();

    await runAxe(page, '/merchant/pos', POS_ALLOWLIST);
  });
});
