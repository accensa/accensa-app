import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  buildChallengeTransaction,
  CHALLENGE_OPERATION,
  parseChallengeXdr,
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
});
