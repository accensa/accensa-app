/**
 * Re-exports from the wallet adapter for backward compatibility.
 *
 * This module previously contained the Freighter-specific implementation
 * directly. It now re-exports the wallet adapter's public API, which
 * defaults to Freighter. New code should import from `@/lib/wallet` instead.
 *
 * @module
 */

export {
  type WalletStatus,
  truncateAddress,
  readStatus,
  connect,
  signTransaction,
  FREIGHTER_INSTALL_URL,
} from './wallet';
