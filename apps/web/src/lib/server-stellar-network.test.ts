import { afterEach, describe, expect, test } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import { StellarNetworkConfigurationError } from '@/lib/auth/stellarAuth';
import { getServerStellarNetworkPassphrase } from './server-stellar-network';

const originalPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE;

afterEach(() => {
  if (originalPassphrase === undefined) {
    delete process.env.STELLAR_NETWORK_PASSPHRASE;
  } else {
    process.env.STELLAR_NETWORK_PASSPHRASE = originalPassphrase;
  }
});

describe('getServerStellarNetworkPassphrase', () => {
  test.each([undefined, '', '   '])('rejects an unset or blank passphrase (%s)', (passphrase) => {
    if (passphrase === undefined) {
      delete process.env.STELLAR_NETWORK_PASSPHRASE;
    } else {
      process.env.STELLAR_NETWORK_PASSPHRASE = passphrase;
    }

    expect(() => getServerStellarNetworkPassphrase()).toThrow(StellarNetworkConfigurationError);
    expect(() => getServerStellarNetworkPassphrase()).toThrow('STELLAR_NETWORK_PASSPHRASE');
  });

  test('returns a recognized passphrase', () => {
    process.env.STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;

    expect(getServerStellarNetworkPassphrase()).toBe(Networks.PUBLIC);
  });

  test('rejects an unrecognized passphrase', () => {
    process.env.STELLAR_NETWORK_PASSPHRASE = 'Unknown Stellar Network';

    expect(() => getServerStellarNetworkPassphrase()).toThrow(StellarNetworkConfigurationError);
    expect(() => getServerStellarNetworkPassphrase()).toThrow('STELLAR_NETWORK_PASSPHRASE');
  });
});
