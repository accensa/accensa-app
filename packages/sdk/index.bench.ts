import { bench, describe } from 'vitest';
import { toSettleHookPayload, type Settlement } from './index';

/**
 * Benchmark harness for issue #338 (index.test.ts performance/allocation
 * review). Run with `pnpm --filter @accensa/sdk bench` — it is not part of
 * `pnpm test`, so CI time is unchanged.
 *
 * What it measures is the hot path the suite exercises thousands of times:
 * building a wire payload from a settlement fixture. Before #338 the suite
 * additionally allocated one `Response` per mocked fetch call (four per retry
 * test); those fixtures are now shared module-level constants in
 * `index.test.ts`, with the allocation-guard test pinning the reuse.
 */

const settlement: Settlement = Object.freeze({
  txHash: 'a'.repeat(64),
  route: '/api/hello',
  method: 'GET',
  requestId: 'req-1',
  payer: 'G' + 'A'.repeat(55),
  amount: '1000',
  network: 'stellar:testnet',
});

describe('settlement fixture throughput', () => {
  bench(
    'toSettleHookPayload (frozen shared fixture)',
    () => {
      toSettleHookPayload(settlement);
    },
    { time: 500, iterations: 10_000 },
  );

  bench(
    'toSettleHookPayload (fresh object per call, the pre-#338 pattern)',
    () => {
      toSettleHookPayload({ ...settlement, txHash: 'a'.repeat(64) });
    },
    { time: 500, iterations: 10_000 },
  );
});
