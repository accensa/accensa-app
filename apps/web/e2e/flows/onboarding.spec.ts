import { test, expect } from '../fixtures/wallet';
import type { Page } from '@playwright/test';
import { mintSessionCookie } from '../helpers/auth';

/**
 * Functional e2e spec for the merchant onboarding walkthrough
 * (`src/app/merchant/onboarding/page.tsx`).
 *
 * All progress is browser state under `accensa-merchant-onboarding`
 * (`page.tsx:8`): it is written on every step (`page.tsx:54`) and completion is
 * decided from it (`page.tsx:96`). The cases below are the ones a component
 * test cannot cover — a real reload, with the mocked wallet, half-way through.
 */

const STORAGE_KEY = 'accensa-merchant-onboarding';
const WALLET_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const DESTINATION = 'GB'.padEnd(56, 'B');
const WEBHOOK = 'https://merchant.example/webhooks/accensa';
const STEP_TITLES = [
  /Connect wallet/,
  /Settlement preferences/,
  /API keys and webhook/,
  /Test checkout/,
];

async function openOnboarding(page: Page) {
  const cookie = await mintSessionCookie();
  await page.context().addCookies([
    {
      name: 'accensa_session',
      value: cookie.split(';')[0].split('=')[1],
      url: 'http://127.0.0.1:3000',
    },
  ]);
}

/**
 * `mockWallet` (e2e/fixtures/wallet.ts) answers `isConnected()`, which
 * freighter-api 6 derives from `window.freighter`. `requestAccess()` and
 * `getNetworkDetails()` are postMessage round-trips that only the extension
 * answers — a plain `window.freighter` object leaves `connect()` waiting — so
 * this installs the responder an extension would otherwise provide. It is
 * scoped to this spec because mocks.ts and the shared fixture are owned by
 * other changes.
 */
async function answerFreighterRounds(page: Page) {
  await page.addInitScript((address: string) => {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data as {
        source?: string;
        messageId?: number;
        type?: string;
      } | null;
      if (!data || data.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST') return;

      const reply: Record<string, unknown> = {
        source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
        messagedId: data.messageId,
      };
      if (data.type === 'REQUEST_ACCESS' || data.type === 'REQUEST_PUBLIC_KEY') {
        reply.publicKey = address;
        reply.isConnected = true;
      } else if (data.type === 'REQUEST_NETWORK_DETAILS') {
        reply.networkDetails = {
          network: 'TESTNET',
          networkPassphrase: 'Test SDF Network ; September 2015',
        };
      }
      window.postMessage(reply, window.location.origin);
    });
  }, WALLET_ADDRESS);
}

const stepper = (page: Page) => page.getByRole('list', { name: 'Merchant setup progress' });
const stepButton = (page: Page, title: RegExp) =>
  stepper(page).getByRole('button', { name: title });

test.describe('merchant onboarding', () => {
  test('walks all four steps with the mocked wallet and never replays a completed step', async ({
    page,
    mockWallet,
  }) => {
    await mockWallet();
    await answerFreighterRounds(page);
    await openOnboarding(page);
    // The step saves the webhook over PATCH; answering here keeps this spec
    // self-contained (mocks.ts is shared with the dashboard flows).
    await page.route('**/api/merchant/profile', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto('/merchant/onboarding');

    // Step 1 — connect. A tick replaces the step number (OnboardingStepper.tsx:32).
    await expect(stepButton(page, STEP_TITLES[0])).not.toContainText('✓');
    await expect(stepButton(page, STEP_TITLES[0])).toHaveAttribute('aria-current', 'step');
    await page.getByRole('button', { name: 'Connect Stellar wallet' }).click();
    await expect(page.getByText(`Connected: ${WALLET_ADDRESS}`)).toBeVisible();
    await expect(stepButton(page, STEP_TITLES[0])).toContainText('✓');

    // Reload straight after connecting: the completed step must stay complete.
    await page.reload();
    await expect(stepButton(page, STEP_TITLES[0])).toContainText('✓');
    const afterConnect = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    expect(JSON.parse(afterConnect!).walletAddress).toBe(WALLET_ADDRESS);

    // Step 2 — settlement preferences.
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(stepButton(page, STEP_TITLES[1])).toHaveAttribute('aria-current', 'step');
    await page.getByLabel(/Settlement asset/).selectOption('XLM');
    await page.getByLabel(/Destination Stellar account/).fill(DESTINATION);
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(stepButton(page, STEP_TITLES[1])).toContainText('✓');

    // Reload mid-walkthrough: the finished step is not replayed and the current
    // step is restored from storage as well.
    await page.reload();
    await expect(stepButton(page, STEP_TITLES[0])).toContainText('✓');
    await expect(stepButton(page, STEP_TITLES[1])).toContainText('✓');
    await expect(stepButton(page, STEP_TITLES[1])).toHaveAttribute('aria-current', 'step');

    // Step 3 — API keys and webhook.
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(stepButton(page, STEP_TITLES[2])).toHaveAttribute('aria-current', 'step');
    await page.getByLabel(/Webhook endpoint/).fill(WEBHOOK);
    const patched = page.waitForRequest(
      (request) => request.method() === 'PATCH' && request.url().includes('/api/merchant/profile'),
    );
    await page.getByRole('button', { name: 'Save and continue' }).click();
    expect((await patched).postDataJSON()).toEqual({ webhookUrl: WEBHOOK });
    await expect(stepButton(page, STEP_TITLES[2])).toContainText('✓');

    // Step 4 — local checkout preview completes the checklist.
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(stepButton(page, STEP_TITLES[3])).toHaveAttribute('aria-current', 'step');
    await page.getByRole('button', { name: 'Run local checkout preview' }).click();
    // The fourth step completing is what makes `finished` true, so the
    // checklist is replaced by the completion section immediately.
    await expect(page.getByText('Setup complete')).toBeVisible();
    for (const title of STEP_TITLES) {
      await expect(stepButton(page, title)).toContainText('✓');
    }

    // Completion survives a further reload.
    await page.reload();
    await expect(page.getByText('Setup complete')).toBeVisible();
    for (const title of STEP_TITLES) {
      await expect(stepButton(page, title)).toContainText('✓');
    }
  });

  test('recovers from a corrupted stored value instead of crashing', async ({ page }) => {
    await openOnboarding(page);
    await page.goto('/merchant/onboarding');

    // page.tsx:34-43 catches the parse failure, discards the key and starts over.
    await page.evaluate((key) => localStorage.setItem(key, '{not valid json'), STORAGE_KEY);
    await page.reload();

    await expect(page.getByRole('heading', { name: 'Get Accensa ready' })).toBeVisible();
    await expect(stepButton(page, STEP_TITLES[0])).toHaveAttribute('aria-current', 'step');
    await expect(stepButton(page, STEP_TITLES[0])).not.toContainText('✓');
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
  });
});
