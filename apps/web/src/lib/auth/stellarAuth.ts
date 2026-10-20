import {
  Account,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

/**
 * Accepted environment variable pairs:
 * - STELLAR_NETWORK_PASSPHRASE / NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE:
 *     Full passphrase string (e.g. "Public Global Stellar Network ; September 2015" or "Test SDF Network ; September 2015")
 * - STELLAR_NETWORK / NEXT_PUBLIC_STELLAR_NETWORK:
 *     Network name (e.g. "mainnet", "public", "testnet", "futurenet", "standalone")
 *
 * If nothing is set, the fallback is Networks.TESTNET.
 * Unrecognised passphrases or network names throw a named StellarNetworkConfigurationError.
 */
export interface StellarNetworkConfig {
  name: string;
  passphrase: string;
}

export class StellarNetworkConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StellarNetworkConfigurationError';
  }
}

export const KNOWN_NETWORKS: Record<string, StellarNetworkConfig> = {
  [Networks.PUBLIC]: { name: 'mainnet', passphrase: Networks.PUBLIC },
  [Networks.TESTNET]: { name: 'testnet', passphrase: Networks.TESTNET },
  [Networks.FUTURENET]: { name: 'futurenet', passphrase: Networks.FUTURENET },
  [Networks.STANDALONE]: { name: 'standalone', passphrase: Networks.STANDALONE },
};

export const NETWORK_NAMES: Record<string, StellarNetworkConfig> = {
  mainnet: { name: 'mainnet', passphrase: Networks.PUBLIC },
  public: { name: 'mainnet', passphrase: Networks.PUBLIC },
  testnet: { name: 'testnet', passphrase: Networks.TESTNET },
  futurenet: { name: 'futurenet', passphrase: Networks.FUTURENET },
  standalone: { name: 'standalone', passphrase: Networks.STANDALONE },
  local: { name: 'standalone', passphrase: Networks.STANDALONE },
};

export function resolveStellarNetwork(
  env: {
    passphrase?: string | null;
    network?: string | null;
  } = {},
): StellarNetworkConfig {
  const passphrase = env.passphrase?.trim();
  const network = env.network?.trim()?.toLowerCase();

  if (passphrase) {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_NETWORKS, passphrase)) {
      throw new StellarNetworkConfigurationError(
        `Unrecognised Stellar network passphrase: "${passphrase}"`,
      );
    }
    return KNOWN_NETWORKS[passphrase];
  }

  if (network) {
    if (!Object.prototype.hasOwnProperty.call(NETWORK_NAMES, network)) {
      throw new StellarNetworkConfigurationError(`Unrecognised Stellar network: "${network}"`);
    }
    return NETWORK_NAMES[network];
  }

  return KNOWN_NETWORKS[Networks.TESTNET];
}

export function getStellarNetwork(): StellarNetworkConfig {
  const isClient = typeof window !== 'undefined';
  const passphrase = isClient
    ? process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE || undefined
    : process.env.STELLAR_NETWORK_PASSPHRASE ||
      process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ||
      undefined;
  const network = isClient
    ? process.env.NEXT_PUBLIC_STELLAR_NETWORK || undefined
    : process.env.STELLAR_NETWORK || process.env.NEXT_PUBLIC_STELLAR_NETWORK || undefined;

  return resolveStellarNetwork({ passphrase, network });
}

export const STELLAR_NETWORK = getStellarNetwork();

export const CHALLENGE_TTL_SECONDS = 5 * 60;
export const CHALLENGE_OPERATION = 'Accensa Auth';

export function networkPassphrase(): string {
  return getStellarNetwork().passphrase;
}

export function generateChallengeNonce(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomBytes } = require('crypto');
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
