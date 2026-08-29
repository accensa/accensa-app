import { unstable_cache } from 'next/cache';
import { withClient } from './db';
import { getMerchantByAddress, type Merchant, type MerchantProfileUpdate } from './merchants';

/**
 * Reading and validating the merchant profile: the mutable fields on
 * `merchants` (signing key, asset watch-list, refund vault, webhook URL).
 *
 * `getMerchantFromRequest` backs the auth/scoping check on nearly every API
 * route, which meant this row was re-read from Postgres on every request even
 * though these fields change rarely. `GET /api/merchant/profile` is the one
 * route that fronts a cached copy instead - see `getCachedMerchantByAddress`
 * below. Every other route keeps reading `merchants` live on purpose: RLS
 * scoping and settlement-signature verification must never act on a stale key
 * or vault ID.
 */

/** Ed25519 public keys: 32 bytes, hex-encoded. */
const HEX_32_BYTES = /^[0-9a-f]{64}$/i;

/** Soroban contract IDs: 56-character base32 starting with C. */
const CONTRACT_ID = /^C[A-Z2-7]{55}$/;

/** The Data Cache tag scoping one merchant's cached profile. */
export function merchantProfileCacheTag(address: string): string {
  return `merchant-profile-${address}`;
}

/**
 * Cached merchant lookup by address, tagged per merchant so updating one
 * merchant's profile never invalidates another tenant's cached copy.
 */
export async function getCachedMerchantByAddress(address: string): Promise<Merchant | null> {
  return unstable_cache(
    async () => withClient((client) => getMerchantByAddress(client, address)),
    ['merchant-profile', address],
    { tags: [merchantProfileCacheTag(address)] },
  )();
}

/** Cached equivalent of `getMerchantFromRequest` for read-only profile access. */
export async function getCachedMerchantFromRequest(request: Request): Promise<Merchant | null> {
  const address = request.headers.get('x-accensa-merchant');
  if (!address) return null;
  return getCachedMerchantByAddress(address);
}

export type ParseProfileUpdateResult =
  { ok: true; update: MerchantProfileUpdate } | { ok: false; error: string };

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates a `PATCH /api/merchant/profile` body.
 *
 * Every field is optional and independently nullable: omitting a key leaves
 * that column untouched, while `null` clears it back to the deployment-wide
 * default (see the `Merchant` docstring in `./merchants`).
 */
export function parseMerchantProfileUpdate(body: unknown): ParseProfileUpdateResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;
  const update: MerchantProfileUpdate = {};

  if ('publicKeyHex' in b) {
    if (b.publicKeyHex === null) {
      update.publicKeyHex = null;
    } else if (typeof b.publicKeyHex !== 'string' || !HEX_32_BYTES.test(b.publicKeyHex)) {
      return { ok: false, error: 'publicKeyHex must be a hex-encoded 32-byte Ed25519 key' };
    } else {
      update.publicKeyHex = b.publicKeyHex.toLowerCase();
    }
  }

  if ('assetContractIds' in b) {
    if (b.assetContractIds === null) {
      update.assetContractIds = null;
    } else if (
      !Array.isArray(b.assetContractIds) ||
      b.assetContractIds.some((id) => typeof id !== 'string' || !CONTRACT_ID.test(id))
    ) {
      return { ok: false, error: 'assetContractIds must be an array of Soroban contract IDs' };
    } else {
      update.assetContractIds = b.assetContractIds as string[];
    }
  }

  if ('refundVaultId' in b) {
    if (b.refundVaultId === null) {
      update.refundVaultId = null;
    } else if (typeof b.refundVaultId !== 'string' || !CONTRACT_ID.test(b.refundVaultId)) {
      return { ok: false, error: 'refundVaultId must be a Soroban contract ID' };
    } else {
      update.refundVaultId = b.refundVaultId;
    }
  }

  if ('webhookUrl' in b) {
    if (b.webhookUrl === null) {
      update.webhookUrl = null;
    } else if (typeof b.webhookUrl !== 'string' || !isHttpUrl(b.webhookUrl)) {
      return { ok: false, error: 'webhookUrl must be an http(s) URL' };
    } else {
      update.webhookUrl = b.webhookUrl;
    }
  }

  return { ok: true, update };
}
