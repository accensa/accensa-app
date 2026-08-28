/**
 * Stellar Expert explorer links, derived from the configured network.
 *
 * This is the single place in `apps/web/src` that knows the explorer URL shape.
 * Every view that links a transaction or a contract goes through here, so a
 * mainnet deployment is one environment variable rather than five string edits
 * scattered across pages — and a link can never again point at a testnet page
 * for a transaction that only exists on mainnet.
 */

export type StellarNetwork = 'testnet' | 'mainnet';

const NETWORK_ENV = 'NEXT_PUBLIC_STELLAR_NETWORK';

/** stellar.expert names the mainnet network `public` in its URL path. */
const EXPLORER_SEGMENT: Record<StellarNetwork, string> = {
  testnet: 'testnet',
  mainnet: 'public',
};

export const STELLAR_EXPERT_ORIGIN = 'https://stellar.expert';

let warnedAboutUnsetNetwork = false;

/**
 * Resolves the Stellar network the app is pointed at.
 *
 * - A recognised value (`testnet`, `mainnet`, or the `public`/`pubnet` aliases)
 *   is used directly.
 * - An unrecognised value throws: a typo here would otherwise send every link
 *   to the wrong network silently.
 * - An unset value falls back to `testnet` and warns once. It does not throw,
 *   because a hard failure would take down statically-rendered pages at build
 *   time; the warning is the "clearly-labelled default" that keeps an
 *   unconfigured mainnet deploy from being silent.
 */
export function resolveStellarNetwork(
  raw: string | undefined = process.env.NEXT_PUBLIC_STELLAR_NETWORK,
): StellarNetwork {
  const value = raw?.trim().toLowerCase();

  if (value === 'testnet') return 'testnet';
  if (value === 'mainnet' || value === 'public' || value === 'pubnet') return 'mainnet';

  if (value) {
    throw new Error(
      `${NETWORK_ENV} is "${raw}", which is not a known Stellar network. ` +
        `Set it to "mainnet" or "testnet".`,
    );
  }

  if (!warnedAboutUnsetNetwork && typeof console !== 'undefined') {
    warnedAboutUnsetNetwork = true;
    console.warn(
      `${NETWORK_ENV} is not set; explorer links will point at testnet. ` +
        `Set it to "mainnet" for a production deployment.`,
    );
  }
  return 'testnet';
}

function explorerBase(network: StellarNetwork): string {
  return `${STELLAR_EXPERT_ORIGIN}/explorer/${EXPLORER_SEGMENT[network]}`;
}

/** Link to a transaction on the block explorer. */
export function explorerTxUrl(
  txHash: string,
  network: StellarNetwork = resolveStellarNetwork(),
): string {
  return `${explorerBase(network)}/tx/${txHash}`;
}

/** Link to a contract on the block explorer. */
export function explorerContractUrl(
  contractId: string,
  network: StellarNetwork = resolveStellarNetwork(),
): string {
  return `${explorerBase(network)}/contract/${contractId}`;
}
