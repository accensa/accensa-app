import type { Client } from 'pg';

/**
 * A tenant of this deployment.
 *
 * `address` is the Stellar G-address that identifies the merchant everywhere:
 * it is the SAC `transfer` recipient the indexer filters on, the account that
 * signs the SEP-10-style auth challenge, and the account whose key would sign
 * a refund. `publicKeyHex` is a *separate* raw Ed25519 key used only to verify
 * `/api/hook/settle` reports — historically `MERCHANT_PUBLIC_KEY`, kept
 * distinct because a seller's settlement-reporting key does not have to be the
 * same key that controls the Stellar account.
 *
 * `assetContractIds`, `refundVaultId`, and `webhookUrl` are per-merchant
 * overrides. Null means "fall back to the deployment-wide default env var" —
 * this keeps a single-merchant deployment working with zero new configuration
 * after the migration backfills its one row.
 */
export interface Merchant {
  id: number;
  address: string;
  publicKeyHex: string | null;
  assetContractIds: string[] | null;
  refundVaultId: string | null;
  webhookUrl: string | null;
}

interface MerchantRow {
  id: number;
  address: string;
  public_key_hex: string | null;
  asset_contract_ids: string | null;
  refund_vault_id: string | null;
  webhook_url: string | null;
}

function fromRow(row: MerchantRow): Merchant {
  return {
    id: row.id,
    address: row.address,
    publicKeyHex: row.public_key_hex,
    assetContractIds: row.asset_contract_ids
      ? row.asset_contract_ids
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : null,
    refundVaultId: row.refund_vault_id,
    webhookUrl: row.webhook_url,
  };
}

/** Looks up a merchant by their Stellar address. Null when unknown. */
export async function getMerchantByAddress(
  client: Client,
  address: string,
): Promise<Merchant | null> {
  const res = await client.query<MerchantRow>(
    `SELECT id, address, public_key_hex, asset_contract_ids, refund_vault_id, webhook_url
     FROM merchants WHERE address = $1`,
    [address],
  );
  return res.rows.length ? fromRow(res.rows[0]) : null;
}

export async function getMerchantById(client: Client, id: number): Promise<Merchant | null> {
  const res = await client.query<MerchantRow>(
    `SELECT id, address, public_key_hex, asset_contract_ids, refund_vault_id, webhook_url
     FROM merchants WHERE id = $1`,
    [id],
  );
  return res.rows.length ? fromRow(res.rows[0]) : null;
}

/**
 * Resolves the merchant scoping a request.
 *
 * `apps/web/src/middleware.ts` verifies the session cookie and forwards the
 * signed-in Stellar address as `x-accensa-merchant` — routes trust that
 * header rather than re-verifying the cookie themselves, since middleware has
 * already run and the header cannot be forged by the caller (middleware
 * overwrites it on every request it forwards). Null means the header is
 * missing, empty, or names a merchant this deployment doesn't have.
 */
export async function getMerchantFromRequest(
  client: Client,
  request: Request,
): Promise<Merchant | null> {
  const address = request.headers.get('x-accensa-merchant');
  if (!address) return null;
  return getMerchantByAddress(client, address);
}

/** Every merchant configured on this deployment, in a stable order for the indexer sweep. */
export async function listMerchants(client: Client): Promise<Merchant[]> {
  const res = await client.query<MerchantRow>(
    `SELECT id, address, public_key_hex, asset_contract_ids, refund_vault_id, webhook_url
     FROM merchants ORDER BY id ASC`,
  );
  return res.rows.map(fromRow);
}

/**
 * A partial write to the mutable fields of a `Merchant`.
 *
 * `address` and `id` are the merchant's identity and are never written here.
 * A key present with value `null` clears that column back to the
 * deployment-wide default; an absent key leaves the column untouched.
 */
export interface MerchantProfileUpdate {
  publicKeyHex?: string | null;
  assetContractIds?: string[] | null;
  refundVaultId?: string | null;
  webhookUrl?: string | null;
}

/**
 * Applies a partial profile update and returns the merchant's new state.
 *
 * Only columns present in `update` are written, so a caller that omits a
 * field can never accidentally null it out.
 */
export async function updateMerchantProfile(
  client: Client,
  merchantId: number,
  update: MerchantProfileUpdate,
): Promise<Merchant | null> {
  const sets: string[] = [];
  const params: (string | null)[] = [];

  if ('publicKeyHex' in update) {
    params.push(update.publicKeyHex ?? null);
    sets.push(`public_key_hex = $${params.length + 1}`);
  }
  if ('assetContractIds' in update) {
    params.push(update.assetContractIds?.length ? update.assetContractIds.join(',') : null);
    sets.push(`asset_contract_ids = $${params.length + 1}`);
  }
  if ('refundVaultId' in update) {
    params.push(update.refundVaultId ?? null);
    sets.push(`refund_vault_id = $${params.length + 1}`);
  }
  if ('webhookUrl' in update) {
    params.push(update.webhookUrl ?? null);
    sets.push(`webhook_url = $${params.length + 1}`);
  }

  if (sets.length === 0) {
    return getMerchantById(client, merchantId);
  }

  const res = await client.query<MerchantRow>(
    `UPDATE merchants SET ${sets.join(', ')} WHERE id = $1
     RETURNING id, address, public_key_hex, asset_contract_ids, refund_vault_id, webhook_url`,
    [merchantId, ...params],
  );
  return res.rows.length ? fromRow(res.rows[0]) : null;
}
