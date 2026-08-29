import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeTransferEvent, stroopsToAmount } from './decode.mjs';

// Real Soroban RPC output, captured on testnet - the same fixture apps/web's
// own decoder is tested against (apps/web/src/lib/__fixtures__/sac-transfer-events.json).
// Reusing the *fixture* (raw RPC bytes) is not reusing decode code; asserting
// this independent decoder reaches the same answer on the same raw bytes is
// exactly the cross-check this package exists to provide.
const fixturePath = fileURLToPath(
  new URL('../../apps/web/src/lib/__fixtures__/sac-transfer-events.json', import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

test('stroopsToAmount formats whole and fractional amounts at 7 places', () => {
  assert.equal(stroopsToAmount(125_000_000n), '12.5000000');
  assert.equal(stroopsToAmount(1n), '0.0000001');
  assert.equal(stroopsToAmount(-125_000_000n), '-12.5000000');
});

test('stroopsToAmount does not lose precision beyond Number.MAX_SAFE_INTEGER', () => {
  const huge = 90_071_992_547_409_910_000n;
  assert.equal(stroopsToAmount(huge), '9007199254740.9910000');
});

test('decodes every captured real event', () => {
  const decoded = fixture.events.map(decodeTransferEvent);
  assert.ok(decoded.every((d) => d !== null));
});

test('agrees with apps/web/src/lib/stellar-events.ts on the known transfer', () => {
  const known = fixture.events.find((e) => e.txHash === fixture.known.txHash);
  const decoded = decodeTransferEvent(known);
  assert.ok(decoded);
  assert.equal(decoded.payer, fixture.known.expected.from);
  assert.equal(decoded.to, fixture.known.expected.to);
  assert.equal(decoded.asset, fixture.known.expected.asset);
  assert.equal(decoded.stroops.toString(), fixture.known.expected.stroops);
  assert.equal(decoded.amount, fixture.known.expected.amount);
});

test('returns amount as a string and stroops as a bigint, never a float', () => {
  const decoded = decodeTransferEvent(fixture.events[0]);
  assert.equal(typeof decoded.amount, 'string');
  assert.equal(typeof decoded.stroops, 'bigint');
});

test('returns null rather than throwing on malformed input', () => {
  const valid = fixture.events[0];
  assert.equal(decodeTransferEvent({ ...valid, topic: [] }), null);
  assert.equal(decodeTransferEvent({ ...valid, topic: ['not-base64-xdr', 'x', 'y'] }), null);
  assert.equal(decodeTransferEvent({ ...valid, value: undefined }), null);
  assert.equal(decodeTransferEvent({ ...valid, value: 'garbage' }), null);
});

test('returns null for a non-transfer event (right shape, wrong name)', () => {
  const valid = fixture.events[0];
  const fee = {
    ...valid,
    topic: [
      'AAAADwAAAANmZWUA',
      'AAAAEgAAAAAAAAAAl2Uc5zBdi7JyKFLTCKSyIcbmwDZj4zw8atklhxblH7Y=',
      'AAAAEgAAAAAAAAAAl2Uc5zBdi7JyKFLTCKSyIcbmwDZj4zw8atklhxblH7Y=',
    ],
  };
  assert.equal(decodeTransferEvent(fee), null);
});
