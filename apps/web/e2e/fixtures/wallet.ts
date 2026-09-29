import { test as base, expect } from '@playwright/test';

type WalletFixture = {
  mockWallet: () => Promise<void>;
};

export const test = base.extend<WalletFixture>({
  mockWallet: async ({ page }, use) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(async () => {
      await page.addInitScript(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).freighter = {
          isConnected: () => Promise.resolve(true),
          getPublicKey: () =>
            Promise.resolve('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'),
          signTransaction: (xdr: string) => Promise.resolve('signed_' + xdr),
          signAuthEntry: (_entry: string) => Promise.resolve(new Uint8Array([1, 2, 3])),
        };
      });
    });
  },
});

export { expect };
