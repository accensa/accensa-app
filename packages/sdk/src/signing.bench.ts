/**
 * Cost of signing one settlement report.
 *
 * `pnpm vitest bench src/signing.bench.ts`. The "cold" case forces a fresh
 * key import on every call, which is what every report cost before imported
 * keys were reused; "warm" is the steady state for a merchant signing every
 * report with the same key.
 */
import { bench, describe } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { signSettlementPayload } from './signing';

function seedHex(): string {
  const der = generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' });
  return (der as Buffer).subarray(16).toString('hex');
}

const payload = JSON.stringify({
  tx_hash: 'a'.repeat(64),
  route: '/api/hello',
  method: 'GET',
  reported_at: new Date().toISOString(),
});

// Two keys alternated defeat the single-entry cache, reproducing a fresh
// import on every call.
const keys = [seedHex(), seedHex()];
let turn = 0;

describe('signSettlementPayload', () => {
  bench('cold: key imported on every call', async () => {
    turn ^= 1;
    await signSettlementPayload(payload, keys[turn]);
  });

  bench('warm: imported key reused', async () => {
    await signSettlementPayload(payload, keys[0]);
  });
});
