import { NextResponse } from 'next/server';
import { withClient } from '@/lib/db';

export const dynamic = 'force-dynamic';

const RPC_URL = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';

/**
 * Cursor-lag health check, polled from *outside* the sync path (issue #90).
 *
 * The indexer already computes `skippedLedgers` and the workflow already logs
 * it — into a GitHub Actions warning on a job that always goes green. Nobody is
 * paged. This endpoint answers "how far behind head is the cursor, right now?"
 * so an external uptime monitor (or the `stale-check` workflow) can alert a
 * human before ledgers fall out of RPC retention and become unrecoverable.
 *
 * `MAX_LOOKBACK` in the sync route is 100_000 and testnet retention was
 * ~121_000 ledgers on 2026-08-10. At ~5s/ledger that is roughly 29 hours of
 * head-room between "lag threshold crossed" and "data lost", so a `warn`
 * threshold of 60_000 ledgers (~83h) and a `critical` of 90_000 (~125h, still
 * inside retention) leave hours to react rather than minutes.
 */
const LAG_WARN = Number(process.env.SYNC_LAG_WARN_LEDGERS ?? 60_000);
const LAG_CRITICAL = Number(process.env.SYNC_LAG_CRITICAL_LEDGERS ?? 90_000);
const NO_SYNC_CRITICAL_MS = Number(process.env.SYNC_STALE_MS ?? 3 * 60 * 60 * 1000);

interface MerchantHealth {
  merchantId: number;
  lastLedger: number | null;
  lastSyncedAt: string | null;
  lagLedgers: number | null;
  ageMs: number | null;
  status: 'ok' | 'warn' | 'critical';
  reasons: string[];
}

async function latestLedger(): Promise<number> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger', params: {} }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`getLatestLedger failed: ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`getLatestLedger: ${body.error.message ?? 'unknown'}`);
  return body.result.sequence as number;
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }

  let head: number;
  try {
    head = await latestLedger();
  } catch (error) {
    return NextResponse.json(
      { status: 'critical', error: error instanceof Error ? error.message : 'RPC unreachable' },
      { status: 503 },
    );
  }

  const now = Date.now();
  const merchants = await withClient(async (client) => {
    const { rows } = await client.query<{
      merchant_id: number;
      last_ledger: string | null;
      updated_at: Date | string | null;
    }>(
      `SELECT m.id AS merchant_id, s.last_ledger, s.updated_at
         FROM merchants m
         LEFT JOIN sync_state s ON s.merchant_id = m.id
        ORDER BY m.id`,
    );
    return rows.map<MerchantHealth>((r) => {
      const lastLedger = r.last_ledger === null ? null : Number(r.last_ledger);
      const lastSyncedAt =
        r.updated_at === null
          ? null
          : r.updated_at instanceof Date
            ? r.updated_at.toISOString()
            : String(r.updated_at);
      const lagLedgers = lastLedger === null ? null : Math.max(0, head - lastLedger);
      const ageMs = lastSyncedAt === null ? null : now - Date.parse(lastSyncedAt);

      const reasons: string[] = [];
      let status: MerchantHealth['status'] = 'ok';
      if (lastLedger === null) {
        status = 'warn';
        reasons.push('no cursor recorded yet (cold start)');
      }
      if (lagLedgers !== null && lagLedgers >= LAG_CRITICAL) {
        status = 'critical';
        reasons.push(`cursor lag ${lagLedgers} >= ${LAG_CRITICAL} ledgers`);
      } else if (lagLedgers !== null && lagLedgers >= LAG_WARN) {
        if (status !== 'critical') status = 'warn';
        reasons.push(`cursor lag ${lagLedgers} >= ${LAG_WARN} ledgers`);
      }
      if (ageMs !== null && ageMs >= NO_SYNC_CRITICAL_MS) {
        status = 'critical';
        reasons.push(`no successful sync in ${Math.round(ageMs / 60000)} min`);
      }
      return { merchantId: r.merchant_id, lastLedger, lastSyncedAt, lagLedgers, ageMs, status, reasons };
    });
  });

  const worst = merchants.reduce<MerchantHealth['status']>((acc, m) => {
    if (m.status === 'critical' || acc === 'critical') return 'critical';
    if (m.status === 'warn' || acc === 'warn') return 'warn';
    return 'ok';
  }, 'ok');

  return NextResponse.json(
    { status: worst, head, checkedAt: new Date(now).toISOString(), merchants },
    { status: worst === 'critical' ? 503 : 200 },
  );
}
