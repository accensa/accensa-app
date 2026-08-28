import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rebuildFromChain } from './rebuild.mjs';

const fixturePath = fileURLToPath(
  new URL('../../apps/web/src/lib/__fixtures__/sac-transfer-events.json', import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const MERCHANT = fixture.known.expected.to;

/** A fake Soroban RPC that answers getEvents with the fixture's events, in one page. */
function fakeFetch(events) {
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === 'getEvents') {
      return {
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: { events } }),
      };
    }
    throw new Error(`unexpected RPC method: ${body.method}`);
  };
}

test('rebuildFromChain reconstructs only transfers addressed to the merchant', async () => {
  const { rows } = await rebuildFromChain(
    {
      rpcUrl: 'https://fake-rpc.invalid',
      merchant: MERCHANT,
      assetContractIds: [fixture.source.contract],
      fromLedger: 1,
      toLedger: 4_000_000,
    },
    { fetchImpl: fakeFetch(fixture.events) },
  );

  // Only the "known" event in the fixture is addressed to this merchant;
  // the others are real captured transfers between different accounts.
  assert.equal(rows.size, 1);
  const rebuilt = rows.get(fixture.known.txHash);
  assert.ok(rebuilt);
  assert.equal(rebuilt.payer, fixture.known.expected.from);
  assert.equal(rebuilt.amount, fixture.known.expected.amount);
  assert.equal(rebuilt.asset, fixture.known.expected.asset);
});

test('rebuildFromChain paginates across ledger windows', async () => {
  let calls = 0;
  const fetchImpl = async (_url, init) => {
    calls++;
    const body = JSON.parse(init.body);
    if (body.method === 'getEvents') {
      // Every window comes back empty; this test is only checking that each
      // of the three windows a 25,000-ledger range spans gets its own call.
      return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: { events: [] } }) };
    }
    throw new Error('unexpected');
  };

  const { rows, toLedger } = await rebuildFromChain(
    {
      rpcUrl: 'https://fake-rpc.invalid',
      merchant: MERCHANT,
      assetContractIds: [fixture.source.contract],
      fromLedger: 1,
      toLedger: 25_000, // spans 3 windows of 10,000
    },
    { fetchImpl },
  );

  assert.equal(rows.size, 0);
  assert.equal(toLedger, 25_000);
  // 3 windows, one getEvents call each (empty pages stop immediately).
  assert.equal(calls, 3);
});
