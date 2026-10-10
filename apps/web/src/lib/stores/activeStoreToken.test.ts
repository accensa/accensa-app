import { beforeEach, describe, expect, it } from 'vitest';
import { activeStoreAddress, signActiveStoreToken } from './activeStoreToken';

const ORGANIZATION = `G${'A'.repeat(55)}`;
const STORE = `G${'B'.repeat(55)}`;

describe('active store token', () => {
  beforeEach(() => {
    process.env.JWT_SECRET_KEY = 'store-token-test-secret';
  });

  it('binds the selected store to the authenticated organization', async () => {
    const token = await signActiveStoreToken(ORGANIZATION, STORE);
    expect(await activeStoreAddress(token, ORGANIZATION)).toBe(STORE);
    expect(await activeStoreAddress(token, `G${'C'.repeat(55)}`)).toBeNull();
    expect(await activeStoreAddress(`${token}forged`, ORGANIZATION)).toBeNull();
  });

  it('ignores absent or malformed selection cookies', async () => {
    expect(await activeStoreAddress(undefined, ORGANIZATION)).toBeNull();
    expect(await activeStoreAddress('not-a-token', ORGANIZATION)).toBeNull();
  });
});
