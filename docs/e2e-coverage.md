# E2E route coverage

Route by route, what each Playwright suite actually visits. Two configs, two
ports: visual regression runs against `apps/web/playwright.config.ts` on
**3100** (a dev server), everything else against
`apps/web/playwright.e2e.config.ts` on **3000** (a production build).

| Route                         | Visual — `playwright.config.ts`, port 3100                                 | Accessibility — `playwright.e2e.config.ts`, port 3000 | Flow — `playwright.e2e.config.ts`, port 3000                     | Checkout — `playwright.e2e.config.ts`, port 3000                             |
| ----------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/dashboard`                  | `dashboard-empty.png`, `dashboard-payments.png` — 2 baselines x 6 projects | Yes — `a11y.spec.ts`, plain and payment modal open    | Yes — `flows/dashboard.spec.ts`: 6 tests, modal and CSV included | Yes — `checkout.spec.ts` loads it after `mockWallet()`; no payment assertion |
| `/dashboard/routes`           | N/A                                                                        | Yes — `a11y.spec.ts`                                  | Yes — `flows/dashboard.spec.ts`                                  | N/A                                                                          |
| `/login`                      | N/A                                                                        | Yes — `a11y.spec.ts`                                  | Yes — `flows/dashboard.spec.ts` requires a wallet                | N/A                                                                          |
| `/merchant/disputes`          | `dispute-flow.png` — 1 baseline x 6 projects                               | N/A                                                   | Yes — `flows/disputes.spec.ts`, list plus both urgency windows   | N/A                                                                          |
| `/merchant/disputes/DSP-2002` | N/A                                                                        | N/A                                                   | Yes — `flows/disputes.spec.ts` opens the detail directly         | N/A                                                                          |
| `/merchant/pos`               | `pos-terminal.png` — 1 baseline x 6 projects                               | N/A                                                   | Yes — `flows/pos.spec.ts`, keypad plus reset                     | N/A                                                                          |
| `/merchant/settings/branding` | `checkout-modal.png` — 1 baseline x 6 projects                             | N/A                                                   | N/A                                                              | N/A — the live preview is the visual baseline, not a checkout run            |
| `/verify`                     | N/A                                                                        | Yes — `a11y.spec.ts`                                  | Yes — `flows/dashboard.spec.ts` accepts proof input              | N/A                                                                          |

## Visual baselines

Five baselines across the six projects in `playwright.config.ts`
(`mobile-light`, `mobile-dark`, `tablet-light`, `tablet-dark`,
`desktop-light`, `desktop-dark`) = **30 files** under
`apps/web/e2e/__screenshots__/<project>/`.

`/dashboard` alone owns two of the five (`dashboard-empty.png` and
`dashboard-payments.png`); the modal, disputes and POS each own one.

Three root-level PNGs — `dashboard-empty.png`, `navbar.png`,
`payments-table.png` — are **orphaned**: `snapshotPathTemplate` now includes
`{projectName}`, so nothing resolves them. They are recorded here, not deleted;
`apps/web/e2e/README.md` still describes a navbar baseline that no spec
produces.

## Listing counts

`playwright test --list` on the two configs:

- `playwright.config.ts`: 30 tests in 1 file (5 visual tests x 6 projects).
- `playwright.e2e.config.ts`: 50 tests in 5 files — `a11y.spec.ts` 12,
  `flows/dashboard.spec.ts` 18, `flows/disputes.spec.ts` 10,
  `flows/pos.spec.ts` 8, `checkout.spec.ts` 2 (each x chromium + firefox).
