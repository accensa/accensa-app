/**
 * Wallet adapter interface for multi-wallet support.
 *
 * This module defines a wallet-agnostic interface covering what the Accensa
 * dashboard actually needs: connect, read address, read network, sign a
 * transaction. Freighter remains the default implementation, but any wallet
 * that implements this interface works for sign-in and transaction signing.
 *
 * The interface is deliberately minimal. It covers the surface area the app
 * uses — not every possible wallet feature. Additional capabilities (hardware
 * wallet support, WalletConnect, etc.) are handled by the wallet itself, not
 * by this interface. A hardware-backed account works through a supported
 * wallet because the wallet handles the transport; this app never talks to
 * USB or BLE directly.
 *
 * Hardware wallet note: Freighter supports hardware wallets through its own
 * integration. Albedo is a web-based delegated signer that does not support
 * hardware wallets directly, but WalletConnect-capable wallets (Lobstr,
 * xBull) do. If hardware wallet support is needed beyond Freighter, adding a
 * WalletConnect adapter to this interface would cover it.
 */

import {
  isConnected as freighterIsConnected,
  getAddress as freighterGetAddress,
  getNetwork as freighterGetNetwork,
  requestAccess as freighterRequestAccess,
  signTransaction as freighterSignTransaction,
} from '@stellar/freighter-api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Wallet access status, normalised across all adapters. */
export type WalletStatus =
  /** No extension detected in this browser. */
  | { kind: 'unavailable' }
  /** Extension present, but the site has no approved address. */
  | { kind: 'disconnected' }
  /** Extension present and an address is approved for this site. */
  | { kind: 'connected'; address: string; network?: string }
  /** A call failed. Carries a message fit to render. */
  | { kind: 'error'; message: string };

/** What a wallet must be able to do. */
export interface WalletAdapter {
  /** Human-readable name for error messages and UI labels. */
  readonly name: string;
  /** Where a merchant installs the wallet, for the unavailable state. */
  readonly installUrl: string;

  /** Reads current status without prompting the user. */
  readStatus(): Promise<WalletStatus>;
  /** Prompts the wallet for access. Only call from a user gesture. */
  connect(): Promise<WalletStatus>;
  /** Asks the wallet to sign a transaction envelope. Throws on refusal. */
  signTransaction(
    xdr: string,
    opts: { networkPassphrase: string; address?: string },
  ): Promise<string>;
}

// ---------------------------------------------------------------------------
// Freighter adapter
// ---------------------------------------------------------------------------

/** Normalises anything the API or the runtime can hand back. */
function message(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object') {
    const detail = (error as { message?: unknown }).message;
    if (typeof detail === 'string' && detail) return detail;
  }
  return 'Wallet request failed';
}

/** Reads the network name, treating its absence as "unknown" rather than a fault. */
async function readNetwork(): Promise<string | undefined> {
  try {
    const result = await freighterGetNetwork();
    if (result.error || !result.network) return undefined;
    return result.network;
  } catch {
    return undefined;
  }
}

export const freighterAdapter: WalletAdapter = {
  name: 'Freighter',
  installUrl: 'https://freighter.app/',

  async readStatus(): Promise<WalletStatus> {
    try {
      const connection = await freighterIsConnected();
      if (connection.error) return { kind: 'error', message: message(connection.error) };
      if (!connection.isConnected) return { kind: 'unavailable' };

      const account = await freighterGetAddress();
      if (account.error || !account.address) return { kind: 'disconnected' };

      return { kind: 'connected', address: account.address, network: await readNetwork() };
    } catch (error: unknown) {
      return { kind: 'error', message: message(error) };
    }
  },

  async connect(): Promise<WalletStatus> {
    try {
      const connection = await freighterIsConnected();
      if (!connection.isConnected) return { kind: 'unavailable' };

      const access = await freighterRequestAccess();
      if (access.error || !access.address) return { kind: 'disconnected' };

      return { kind: 'connected', address: access.address, network: await readNetwork() };
    } catch (error: unknown) {
      return { kind: 'error', message: message(error) };
    }
  },

  async signTransaction(
    xdr: string,
    opts: { networkPassphrase: string; address?: string },
  ): Promise<string> {
    const result = await freighterSignTransaction(xdr, opts);
    if (result.error) throw new Error(message(result.error));
    if (!result.signedTxXdr) throw new Error('The wallet did not return a signed transaction');
    return result.signedTxXdr;
  },
};

// ---------------------------------------------------------------------------
// Albedo adapter
// ---------------------------------------------------------------------------

/**
 * Albedo is a web-based delegated signer. It opens a popup window for each
 * request rather than using browser extension messaging. It does not have a
 * "connected" state in the same way extension wallets do — every request
 * opens a popup where the user selects an account.
 *
 * Albedo's `publicKey` intent returns `{ pubkey }` on success.
 * Albedo's `tx` intent returns `{ signed_envelope_xdr }` on success.
 *
 * The `@albedo-link/intent` package must be installed as a dependency.
 * It is imported dynamically so that apps without Albedo do not fail at
 * module resolution time.
 */

/** Shape of the albedo intent module (subset we use). */
interface AlbedoIntent {
  publicKey(params: { token?: string }): Promise<{ pubkey: string }>;
  tx(params: {
    xdr: string;
    network?: string;
    pubkey?: string;
  }): Promise<{ signed_envelope_xdr: string }>;
}

/** Lazily loaded albedo intent module, or null if not installed. */
let albedoModule: AlbedoIntent | null = null;

async function getAlbedo(): Promise<AlbedoIntent | null> {
  if (albedoModule) return albedoModule;
  try {
    const mod = await import('@albedo-link/intent');
    // The default export is the AlbedoIntent object itself.
    albedoModule = (mod as { default: AlbedoIntent }).default ?? (mod as unknown as AlbedoIntent);
    return albedoModule;
  } catch {
    return null;
  }
}

/**
 * Maps a Stellar network passphrase to Albedo's network parameter format.
 * Albedo accepts "testnet" or "public" (not the full passphrase).
 */
function albedoNetwork(networkPassphrase: string): string {
  if (networkPassphrase.includes('Test SDF Network')) return 'testnet';
  if (networkPassphrase.includes('Public Global Stellar Network')) return 'public';
  return networkPassphrase;
}

export const albedoAdapter: WalletAdapter = {
  name: 'Albedo',
  installUrl: 'https://albedo.link/',

  async readStatus(): Promise<WalletStatus> {
    // Albedo is a web-based wallet — it is always "available" if the intent
    // module can be loaded. It does not have a persistent connection state
    // like extension wallets. We report "disconnected" as the default,
    // meaning the user has not yet selected an account for this session.
    const albedo = await getAlbedo();
    if (!albedo) return { kind: 'unavailable' };
    return { kind: 'disconnected' };
  },

  async connect(): Promise<WalletStatus> {
    const albedo = await getAlbedo();
    if (!albedo) return { kind: 'unavailable' };

    try {
      const result = await albedo.publicKey({});
      if (!result.pubkey) return { kind: 'disconnected' };
      return { kind: 'connected', address: result.pubkey, network: undefined };
    } catch {
      // User closed the popup or declined.
      return { kind: 'disconnected' };
    }
  },

  async signTransaction(
    xdr: string,
    opts: { networkPassphrase: string; address?: string },
  ): Promise<string> {
    const albedo = await getAlbedo();
    if (!albedo) throw new Error('Albedo wallet is not available');

    try {
      const result = await albedo.tx({
        xdr,
        network: albedoNetwork(opts.networkPassphrase),
        pubkey: opts.address,
      });
      if (!result.signed_envelope_xdr) {
        throw new Error('Albedo did not return a signed transaction');
      }
      return result.signed_envelope_xdr;
    } catch (error: unknown) {
      throw new Error(message(error));
    }
  },
};

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

/** All registered wallet adapters, in priority order. */
const adapters: WalletAdapter[] = [freighterAdapter, albedoAdapter];

/**
 * Returns all registered wallet adapters.
 *
 * The first adapter is the default — the one used when no specific wallet
 * is selected. Callers can present all of them to the user for selection, or
 * use the default for a seamless experience.
 */
export function getWalletAdapters(): readonly WalletAdapter[] {
  return adapters;
}

/**
 * Returns the default wallet adapter (Freighter).
 *
 * This preserves backward compatibility: existing code that calls
 * `readStatus()`, `connect()`, or `signTransaction()` without specifying
 * a wallet gets Freighter behaviour with no change.
 */
export function getDefaultAdapter(): WalletAdapter {
  return freighterAdapter;
}

/**
 * Returns a wallet adapter by name, or the default if not found.
 */
export function getAdapterByName(name: string): WalletAdapter {
  return adapters.find((a) => a.name.toLowerCase() === name.toLowerCase()) ?? freighterAdapter;
}

// ---------------------------------------------------------------------------
// Backward-compatible re-exports (same API as the old freighter.ts)
// ---------------------------------------------------------------------------

/**
 * `GBXQ…4TQK` — enough of both ends to compare against an explorer, short
 * enough for a navbar.
 */
export function truncateAddress(address: string, lead = 4, tail = 4): string {
  if (lead < 0 || tail < 0) throw new RangeError('lead and tail must not be negative');
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/** Reads current status from the default wallet adapter. */
export async function readStatus(): Promise<WalletStatus> {
  return getDefaultAdapter().readStatus();
}

/** Prompts the default wallet for access. */
export async function connect(): Promise<WalletStatus> {
  return getDefaultAdapter().connect();
}

/** Asks the default wallet to sign a transaction envelope. */
export async function signTransaction(
  xdr: string,
  opts: { networkPassphrase: string; address?: string },
): Promise<string> {
  return getDefaultAdapter().signTransaction(xdr, opts);
}

/** Where a merchant installs the default wallet, for the unavailable state. */
export const FREIGHTER_INSTALL_URL = freighterAdapter.installUrl;
