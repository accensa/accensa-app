import { describe, it, expect, vi } from 'vitest';
import type { Client } from 'pg';
import { updateMerchantProfile, getMerchantById } from './merchants';

const ROW = {
  id: 1,
  address: 'G' + 'A'.repeat(55),
  public_key_hex: 'a'.repeat(64),
  asset_contract_ids: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  refund_vault_id: 'CBHRJU7CF4XIFRNDITFHNQHABKBMFM2FYFHLGWN3JGSFYYCDSMDAWPRV',
  webhook_url: 'https://merchant.example/hook',
};

function fakeClient(returning: Record<string, unknown>[] = [ROW]) {
  const query = vi.fn(async () => ({ rows: returning, rowCount: returning.length }));
  return { query } as unknown as Client;
}

describe('updateMerchantProfile', () => {
  it('writes only the fields present in the update, scoped by id', async () => {
    const client = fakeClient();
    await updateMerchantProfile(client, 1, { webhookUrl: 'https://merchant.example/hook' });

    const [sql, params] = (client.query as ReturnType<typeof vi.fn>).mock.calls[0];
    const setClause = sql.slice(sql.indexOf('SET') + 3, sql.indexOf('WHERE'));
    expect(setClause).toContain('webhook_url = $2');
    expect(setClause).not.toContain('public_key_hex');
    expect(setClause).not.toContain('asset_contract_ids');
    expect(setClause).not.toContain('refund_vault_id');
    expect(sql).toContain('WHERE id = $1');
    expect(params).toEqual([1, 'https://merchant.example/hook']);
  });

  it('joins assetContractIds into the comma-separated column format', async () => {
    const client = fakeClient();
    await updateMerchantProfile(client, 1, {
      assetContractIds: ['CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC', 'CABC'],
    });

    const [, params] = (client.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params[1]).toBe('CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC,CABC');
  });

  it('writes null for a field explicitly cleared', async () => {
    const client = fakeClient();
    await updateMerchantProfile(client, 1, { webhookUrl: null });

    const [, params] = (client.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params).toEqual([1, null]);
  });

  it('writes null for an empty assetContractIds array rather than an empty string', async () => {
    const client = fakeClient();
    await updateMerchantProfile(client, 1, { assetContractIds: [] });

    const [, params] = (client.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params).toEqual([1, null]);
  });

  it('writes every provided field in one query', async () => {
    const client = fakeClient();
    await updateMerchantProfile(client, 1, {
      publicKeyHex: 'b'.repeat(64),
      refundVaultId: 'CBHRJU7CF4XIFRNDITFHNQHABKBMFM2FYFHLGWN3JGSFYYCDSMDAWPRV',
    });

    const [sql, params] = (client.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toContain('public_key_hex = $2');
    expect(sql).toContain('refund_vault_id = $3');
    expect(params).toEqual([
      1,
      'b'.repeat(64),
      'CBHRJU7CF4XIFRNDITFHNQHABKBMFM2FYFHLGWN3JGSFYYCDSMDAWPRV',
    ]);
  });

  it('returns the updated merchant mapped from the RETURNING row', async () => {
    const client = fakeClient([ROW]);
    const result = await updateMerchantProfile(client, 1, { webhookUrl: ROW.webhook_url });
    expect(result).toEqual({
      id: 1,
      address: ROW.address,
      publicKeyHex: ROW.public_key_hex,
      assetContractIds: [ROW.asset_contract_ids],
      refundVaultId: ROW.refund_vault_id,
      webhookUrl: ROW.webhook_url,
    });
  });

  it('returns null when the merchant id does not exist', async () => {
    const client = fakeClient([]);
    const result = await updateMerchantProfile(client, 999, { webhookUrl: 'https://x.example' });
    expect(result).toBeNull();
  });

  it('falls back to a plain read and issues no UPDATE when the update is empty', async () => {
    const client = fakeClient([ROW]);
    const result = await updateMerchantProfile(client, 1, {});

    expect(result).not.toBeNull();
    const [sql] = (client.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).not.toContain('UPDATE');
  });
});

describe('getMerchantById', () => {
  it('queries by id and maps the row', async () => {
    const client = fakeClient([ROW]);
    const result = await getMerchantById(client, 1);
    expect(result?.address).toBe(ROW.address);
    const [sql, params] = (client.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toContain('WHERE id = $1');
    expect(params).toEqual([1]);
  });
});
