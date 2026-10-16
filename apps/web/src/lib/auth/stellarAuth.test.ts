import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  buildChallengeTransaction,
  CHALLENGE_OPERATION,
  parseChallengeXdr,
  resolveStellarNetwork,
  StellarNetworkConfigurationError,
  verifyChallengeSignature,
} from './stellarAuth';

const keypair = Keypair.random();

function challengeXdr(maxTime: number) {
  return new TransactionBuilder(new Account(keypair.publicKey(), '0'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
    timebounds: { minTime: 0, maxTime },
  })
    .addOperation(Operation.manageData({ name: CHALLENGE_OPERATION, value: 'a'.repeat(64) }))
    .build();
}

describe('stellar auth primitives', () => {
  it('builds and verifies a signed five-minute challenge', () => {
    const transaction = buildChallengeTransaction(keypair.publicKey(), 'a'.repeat(64), 100);
    transaction.sign(keypair);
    const parsed = parseChallengeXdr(transaction.toXDR(), 101, Networks.TESTNET);

    expect(parsed.merchantAddress).toBe(keypair.publicKey());
    expect(parsed.nonce).toBe('a'.repeat(64));
    expect(verifyChallengeSignature(parsed.transaction, keypair.publicKey())).toBe(true);
  });

  it('rejects an expired challenge', () => {
    expect(() => parseChallengeXdr(challengeXdr(100).toXDR(), 101, Networks.TESTNET)).toThrow(
      'Challenge expired or invalid',
    );
  });

  it('rejects a signature from another wallet', () => {
    const transaction = buildChallengeTransaction(keypair.publicKey(), 'b'.repeat(64), 100);
    transaction.sign(Keypair.random());
    expect(verifyChallengeSignature(transaction, keypair.publicKey())).toBe(false);
  });

  it('builds and verifies a challenge on a non-default network (mainnet)', () => {
    const mainnetPassphrase = Networks.PUBLIC;
    const transaction = buildChallengeTransaction(
      keypair.publicKey(),
      'c'.repeat(64),
      100,
      mainnetPassphrase,
    );
    transaction.sign(keypair);
    const parsed = parseChallengeXdr(transaction.toXDR(), 101, mainnetPassphrase);

    expect(parsed.merchantAddress).toBe(keypair.publicKey());
    expect(parsed.nonce).toBe('c'.repeat(64));
    expect(verifyChallengeSignature(parsed.transaction, keypair.publicKey())).toBe(true);
  });

  it('resolves recognised mainnet passphrase and network name to mainnet descriptor', () => {
    const fromPassphrase = resolveStellarNetwork({ passphrase: Networks.PUBLIC });
    expect(fromPassphrase.name).toBe('mainnet');
    expect(fromPassphrase.passphrase).toBe(Networks.PUBLIC);

    const fromName = resolveStellarNetwork({ network: 'mainnet' });
    expect(fromName.name).toBe('mainnet');
    expect(fromName.passphrase).toBe(Networks.PUBLIC);
  });

  it('rejects an unrecognised passphrase with a named configuration error', () => {
    expect(() => resolveStellarNetwork({ passphrase: 'Unrecognised Network ; Year 3000' })).toThrow(
      StellarNetworkConfigurationError,
    );
  });

  it('rejects an unrecognised network name with a named configuration error', () => {
    expect(() => resolveStellarNetwork({ network: 'unknown-chain' })).toThrow(
      StellarNetworkConfigurationError,
    );
  });

  it('rejects inherited object prototype properties like constructor or toString', () => {
    expect(() => resolveStellarNetwork({ network: 'constructor' })).toThrow(
      StellarNetworkConfigurationError,
    );
    expect(() => resolveStellarNetwork({ network: 'toString' })).toThrow(
      StellarNetworkConfigurationError,
    );
    expect(() => resolveStellarNetwork({ passphrase: 'constructor' })).toThrow(
      StellarNetworkConfigurationError,
    );
  });
});
