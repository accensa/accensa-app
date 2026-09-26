import {
  Account,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { randomBytes } from 'crypto';

export const CHALLENGE_TTL_SECONDS = 5 * 60;
export const CHALLENGE_OPERATION = 'Accensa Auth';

export function networkPassphrase(): string {
  return process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
}

export function generateChallengeNonce(): string {
  return randomBytes(32).toString('hex');
}

export function buildChallengeTransaction(
  merchantAddress: string,
  nonce: string,
  now = Math.floor(Date.now() / 1000),
  passphrase = networkPassphrase(),
): Transaction {
  return new TransactionBuilder(new Account(merchantAddress, '0'), {
    fee: '100',
    networkPassphrase: passphrase,
    timebounds: { minTime: now - 60, maxTime: now + CHALLENGE_TTL_SECONDS },
  })
    .addOperation(Operation.manageData({ name: CHALLENGE_OPERATION, value: nonce }))
    .build();
}

export function parseChallengeXdr(
  xdr: string,
  now = Math.floor(Date.now() / 1000),
  passphrase = networkPassphrase(),
): { transaction: Transaction; merchantAddress: string; nonce: string } {
  const transaction = new Transaction(xdr, passphrase);
  const minTime = transaction.timeBounds?.minTime
    ? parseInt(transaction.timeBounds.minTime, 10)
    : 0;
  const maxTime = transaction.timeBounds?.maxTime
    ? parseInt(transaction.timeBounds.maxTime, 10)
    : 0;

  if (now < minTime || now > maxTime) throw new Error('Challenge expired or invalid');
  if (transaction.operations.length !== 1 || transaction.operations[0].type !== 'manageData') {
    throw new Error('Invalid challenge structure');
  }

  const operation = transaction.operations[0];
  if (operation.name !== CHALLENGE_OPERATION || !operation.value) {
    throw new Error('Invalid challenge structure');
  }

  return {
    transaction,
    merchantAddress: transaction.source,
    nonce:
      typeof operation.value === 'string'
        ? operation.value
        : Buffer.from(operation.value).toString('utf8'),
  };
}

export function verifyChallengeSignature(
  transaction: Transaction,
  merchantAddress: string,
): boolean {
  const keypair = Keypair.fromPublicKey(merchantAddress);
  return transaction.signatures.some((signature) =>
    keypair.verify(transaction.hash(), signature.signature()),
  );
}
