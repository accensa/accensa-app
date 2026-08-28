import { NextResponse } from 'next/server';
import { decodeTransferEvent, transferTopicFilter, addressTopicFilter } from '@/lib/stellar-events';
import {
  withClient,
  ensureSchema,
  getLastSyncedLedger,
  setLastSyncedLedger,
  getSyncState,
} from '@/lib/db';
import { sweepLedgerRange, EVENTS_PAGE_LIMIT, type EventPage } from '@/lib/event-pager';
import { cooldownRemaining } from '@/lib/sync-status';
import { enqueueWebhookDelivery, payloadFromRow } from '@/lib/webhooks';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RPC_URL = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';

/**
 * Stellar Asset Contracts whose `transfer` events represent revenue. Defaults
 * to the testnet native XLM SAC; set ASSET_CONTRACT_IDS to a comma-separated
 * list to settle in USDC or across multiple assets.
 */
const ASSET_CONTRACT_IDS = (
  process.env.ASSET_CONTRACT_IDS ?? 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Ledgers to look back on a cold start, when no cursor has been stored yet. */
const COLD_START_LOOKBACK = 2_000;

/**
 * Soroban RPC retains only a limited window of ledgers for getEvents.
 *
 * Testnet reported `oldestLedger` about 121,000 behind head on 2026-08-10, so
 * this sits inside it with room to spare. Anything older is simply gone, and a
 * cursor that falls behind it loses the difference for good - see
 * `skippedLedgers` below.
 */
const MAX_LOOKBACK = 100_000;

/**
 * Wall-clock budget for paging, in milliseconds.
 *
 * Held below `maxDuration` so that a backlog too large for one invocation stops
 * cleanly and commits its progress, rather than being killed mid-range with
 * nothing written. The next run resumes from the committed cursor.
 *
 * The budget is checked between windows, so a run can overshoot it by one
 * window. A full 100,000-ledger catch-up measured 55s end to end, which is why
 * this leaves ~20s of headroom under `maxDuration` rather than a token margin.
 */
const PAGING_BUDGET_MS = 40_000;

/**
 * Minimum gap between manual syncs.
 *
 * The dashboard is now authenticated. Indexing is idempotent, so repeated calls
 * one costs Soroban RPC round trips, a database connection and a function
 * invocation. This bounds what a held-down button, or anyone with curl, can
 * spend. A scheduled run counts too - if the data is already current, there is
 * nothing for a manual sync to do.
 */
const MANUAL_COOLDOWN_MS = 60_000;

async function rpc<T>(method: string, params: unknown, maxAttempts = 3): Promise<T> {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`RPC ${method} failed: ${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(`RPC ${method}: ${body.error.message ?? 'unknown error'}`);
      return body.result as T;
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 100)); // Exponential backoff
    }
  }
  throw new Error('Unreachable');
}

/** Reports a cooldown rather than syncing, when one is in force. */
interface CooldownResult {
  cooldown: true;
  retryAfterMs: number;
}

/**
 * Indexes Stellar Asset Contract transfers into the merchant's payment ledger.
 *
 * Shared by both entry points: the scheduled GET, and the POST behind the
 * dashboard's manual trigger. `cooldownMs`, when set, makes the run a no-op if
 * the last sync is more recent than that.
 */
async function runSync(merchant: string, opts: { cooldownMs?: number } = {}) {
  return withClient(async (client) => {
    await ensureSchema(client);

    if (opts.cooldownMs) {
      const state = await getSyncState(client);
      const retryAfterMs = cooldownRemaining(state?.updatedAt, opts.cooldownMs);
      if (retryAfterMs > 0) return { cooldown: true, retryAfterMs } as CooldownResult;
    }

    {
      const { sequence: latestLedger } = await rpc<{ sequence: number }>('getLatestLedger', {});

      const cursor = await getLastSyncedLedger(client);
      const resumeFrom = cursor !== null ? cursor + 1 : latestLedger - COLD_START_LOOKBACK;
      const retentionFloor = latestLedger - MAX_LOOKBACK;
      const startLedger = Math.max(resumeFrom, retentionFloor, 1);

      // The clamp above is not free: when the cursor has fallen outside what the
      // RPC still serves, the ledgers in between are skipped and no later run can
      // recover them. Report the gap rather than let it vanish into a success.
      const skippedLedgers = Math.max(0, retentionFloor - resumeFrom);

      if (startLedger > latestLedger) {
        return {
          latestLedger,
          startLedger,
          syncedTo: startLedger - 1,
          skippedLedgers,
          drained: true,
          pages: 0,
          scanned: 0,
          decoded: 0,
          inserted: 0,
        };
      }

      // Filter server-side to transfers addressed to this merchant. The asset
      // topic is optional across protocol versions, so match both arities.
      const toTopic = addressTopicFilter(merchant);
      const transfer = transferTopicFilter();
      const filters = [
        {
          type: 'contract',
          contractIds: ASSET_CONTRACT_IDS,
          topics: [
            [transfer, '*', toTopic, '*'],
            [transfer, '*', toTopic],
          ],
        },
      ];

      // The limit belongs under `pagination`; sent at the top level the RPC
      // ignores it and applies its own default.
      const deadline = Date.now() + PAGING_BUDGET_MS;
      const { events, sweptThrough, complete, pages, windows } = await sweepLedgerRange(
        ({ startLedger: from, endLedger: to, cursor: pageCursor }) =>
          rpc<EventPage>('getEvents', {
            ...(pageCursor ? {} : { startLedger: from, endLedger: to }),
            filters,
            pagination: { limit: EVENTS_PAGE_LIMIT, ...(pageCursor ? { cursor: pageCursor } : {}) },
            xdrFormat: 'base64',
          }),
        { startLedger, endLedger: latestLedger, withinBudget: () => Date.now() < deadline },
      );

      let inserted = 0;
      let decoded = 0;

      for (const event of events) {
        const transferEvent = decodeTransferEvent(event);
        // A malformed or non-transfer event must not stall the batch.
        if (!transferEvent) continue;
        decoded++;

        // Defensive: never record a transfer that is not to this merchant.
        if (transferEvent.to !== merchant) continue;

        // DO UPDATE, not DO NOTHING: a row may already exist because the
        // merchant reported route attribution before this transfer was
        // indexed, which is the normal ordering — the hook fires the moment
        // x402 settles, this job runs on a schedule. Skipping the conflict
        // would leave that row permanently null and invisible.
        //
        // Only ledger-owned columns are written. route, method, request_id and
        // hook_reported_at belong to the merchant's report and are left alone.
        await client.query('BEGIN');
        try {
          const res = await client.query(
            `INSERT INTO payments (tx_hash, ledger, payer, amount, asset, ts)
  VALUES ($1, $2, $3, $4::numeric, $5, $6::timestamptz)
  ON CONFLICT (tx_hash) DO UPDATE
  SET ledger = EXCLUDED.ledger,
  payer = EXCLUDED.payer,
  amount = EXCLUDED.amount,
  asset = EXCLUDED.asset,
  ts = EXCLUDED.ts
  WHERE payments.ledger IS NULL RETURNING *`,
            [
              transferEvent.txHash,
              transferEvent.ledger,
              transferEvent.from,
              transferEvent.amount, // string - never a float
              transferEvent.asset,
              transferEvent.ledgerClosedAt,
            ],
          );
          if (res.rowCount && res.rowCount > 0 && process.env.WEBHOOK_URL) {
            await enqueueWebhookDelivery(
              client,
              payloadFromRow(res.rows[0] as Record<string, unknown>),
              process.env.WEBHOOK_URL,
            );
          }
          await client.query('COMMIT');
          inserted += res.rowCount ?? 0;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        }
      }

      // The sweep only ever reports whole windows, so this is safe whether or
      // not it reached the head. Crucially it advances across empty windows
      // too - a quiet merchant that never moved the cursor is how the indexer
      // fell behind the RPC retention window and stopped seeing payments.
      await setLastSyncedLedger(client, sweptThrough);

      return {
        latestLedger,
        startLedger,
        syncedTo: sweptThrough,
        skippedLedgers,
        drained: complete,
        pages,
        windows,
        scanned: events.length,
        decoded,
        inserted,
      };
    }
  });
}

/** Maps a run to a response, so both entry points answer identically. */
function respond(result: Awaited<ReturnType<typeof runSync>>) {
  if ('cooldown' in result) {
    const retryAfterMs = Math.ceil(result.retryAfterMs);
    return NextResponse.json(
      { success: true, cooldown: true, retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }
  return NextResponse.json({ success: true, ...result });
}

function configError(): NextResponse | null {
  if (!process.env.MERCHANT_ADDRESS) {
    return NextResponse.json({ error: 'MERCHANT_ADDRESS is not configured' }, { status: 500 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }
  return null;
}

function failed(error: unknown) {
  console.error('Error during sync:', error);
  return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
}

/**
 * Scheduled entry point.
 *
 * Driven by Vercel Cron and by .github/workflows/sync.yml. Protected by
 * CRON_SECRET when set - both senders pass it as a bearer token - so the
 * endpoint cannot be driven by arbitrary callers. No cooldown: a scheduled run
 * is already rate limited by its schedule.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const bad = configError();
  if (bad) return bad;

  try {
    return respond(await runSync(process.env.MERCHANT_ADDRESS as string));
  } catch (error: unknown) {
    return failed(error);
  }
}

/**
 * Manual entry point, behind the dashboard's"Sync now"button.
 *
 * Protected by session authentication via middleware. MANUAL_COOLDOWN_MS bounds the cost.
 */
export async function POST() {
  const bad = configError();
  if (bad) return bad;

  try {
    return respond(
      await runSync(process.env.MERCHANT_ADDRESS as string, { cooldownMs: MANUAL_COOLDOWN_MS }),
    );
  } catch (error: unknown) {
    return failed(error);
  }
}
