import { NextResponse } from 'next/server';
import { decodeTransferEvent, transferTopicFilter, addressTopicFilter } from '@/lib/stellar-events';
import {
  withClient,
  ensureSchema,
  getLastSyncedLedger,
  getSyncState,
  rollbackSyncToLedger,
  setLastSyncedLedger,
  getSyncState,
} from '@/lib/db';
import {
  sweepLedgerRange,
  parallelSweepLedgerRange,
  PARALLEL_SYNC_THRESHOLD,
  EVENTS_PAGE_LIMIT,
  LedgerWindowFetchError,
  type EventPage,
} from '@/lib/event-pager';
import {
  eventsToPaymentRows,
  chunkRows,
  buildBatchInsertSql,
  flattenRows,
  PAYMENTS_BATCH_SIZE,
  type PaymentRow,
} from '@/lib/insert-payments';
import { listMerchants, getMerchantFromRequest, type Merchant } from '@/lib/merchants';
import { cooldownRemaining } from '@/lib/sync-status';
import { broadcastSyncEvent, hasSubscribers } from '@/lib/sync-events';
import { isAuthorizedCronRequest } from '@/lib/cron-auth';
import { logSyncFailure, notifySyncFailure, type SyncFailureContext } from '@/lib/sync-logger';
import { createHmac } from 'node:crypto';

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

      let cursor = await getLastSyncedLedger(client, merchant.id);

      // A chain head lower than the processed cursor means the node rolled
      // back — a re-org, or a failover to a peer that lost its tail. Ledgers
      // past the head no longer exist on the canonical chain, so payments
      // indexed from them describe a chain that is gone: purge them and
      // rewind the cursor to the corrected head before working out where to
      // resume. Without this the early return below would report `drained`
      // while the local ledger silently keeps rolled-back payments.
      let rollback: { purged: number } | null = null;
      if (cursor !== null && latestLedger < cursor) {
        rollback = await rollbackSyncToLedger(client, merchant.id, latestLedger);
        cursor = latestLedger;
      }

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
          // After a rollback there is nothing left to re-scan this
          // invocation — the corrected head is the whole valid range — but
          // the rewind was the work. Surface it so the run is not mistaken
          // for a no-op.
          ...(rollback
            ? { rollback: true, rolledBackTo: latestLedger, purged: rollback.purged }
            : {}),
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

      // Push a real-time update to any subscribed dashboard tab instead of
      // waiting for the next poll (real-time indexer updates). Skipped when no
      // client is listening so an idle sync does no broadcast bookkeeping.
      if (hasSubscribers(merchant.id)) {
        broadcastSyncEvent(merchant.id, {
          merchant: merchant.address,
          syncedTo: sweptThrough,
          inserted,
          scanned,
          pages,
          drained: complete,
          occurredAt: new Date().toISOString(),
        });
      }

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

type SyncResult = Awaited<ReturnType<typeof runSync>>;

/** One merchant's sync throwing instead of returning a result (#135). */
interface SyncFailure {
  merchant: string;
  error: string;
}

/** Maps one merchant's run to its response fragment. */
function summarize(result: SyncResult) {
  if ('cooldown' in result) {
    return { cooldown: true, retryAfterMs: Math.ceil(result.retryAfterMs) };
  }
  return result;
}

/**
 * Builds the context+logging a caught sync error needs, then reports it both
 * to the log (always) and to SYNC_ALERT_WEBHOOK_URL (if configured) (#135).
 *
 * A LedgerWindowFetchError carries the exact window being read when the RPC
 * call failed; anything else (a parsing error, a DB error) is logged without
 * ledger context rather than guessing at one.
 */
function reportSyncError(error: unknown, merchant?: string): void {
  const context: SyncFailureContext = {
    ...(merchant ? { merchant } : {}),
    ...(error instanceof LedgerWindowFetchError
      ? { startLedger: error.startLedger, endLedger: error.endLedger }
      : {}),
  };
  logSyncFailure(context, error);
  // Alerting must never block or fail the sync job itself.
  void notifySyncFailure(context, error);
}

/**
 * Maps a set of per-merchant runs to a response.
 *
 * `.github/workflows/sync.yml` greps the body for `"syncedTo"` to prove real
 * indexing happened (see the comment above that workflow) and for
 * `"skippedLedgers":[1-9]` to catch a retention gap — both stay present here
 * as deployment-wide maximums alongside the full per-merchant `results`, so
 * that check keeps working unchanged whether this deployment has one merchant
 * or many.
 *
 * `failures` (#135) are merchants whose sync threw rather than returned — they
 * no longer abort the whole batch (see GET below), so they are reported here
 * instead: `success` goes false, which the workflow already treats as a
 * warning worth surfacing, while `results`/`syncedTo` still reflect whatever
 * other merchants did complete.
 */
function respond(results: SyncResult[], failures: SyncFailure[] = []) {
  // The manual, single-merchant POST path preserves the original 429 +
  // Retry-After contract exactly, since the dashboard's "Sync now" button
  // already depends on it.
  if (failures.length === 0 && results.length === 1 && 'cooldown' in results[0]) {
    const retryAfterMs = Math.ceil(results[0].retryAfterMs);
    return NextResponse.json(
      { success: true, cooldown: true, retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }
  return NextResponse.json({ success: true, ...result });
}

  const summaries = results.map(summarize);
  const synced = summaries.filter(
    (s): s is Extract<(typeof summaries)[number], { syncedTo: number }> => 'syncedTo' in s,
  );
  const syncedTo = synced.length ? Math.max(...synced.map((s) => s.syncedTo)) : null;
  const skippedLedgers = synced.length ? Math.max(...synced.map((s) => s.skippedLedgers)) : 0;
  const drained = synced.length ? synced.every((s) => s.drained) : true;

  return NextResponse.json({
    success: failures.length === 0,
    results: summaries,
    ...(syncedTo !== null ? { syncedTo, skippedLedgers, drained } : {}),
    ...(failures.length ? { failures } : {}),
  });
}

function failed(error: unknown, merchant?: string) {
  reportSyncError(error, merchant);
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
    const merchants = await withClient(async (client) => {
      await ensureSchema(client);
      return listMerchants(client);
    });

    if (merchants.length === 0) {
      return NextResponse.json({ error: 'No merchants are configured' }, { status: 500 });
    }

    const results: SyncResult[] = [];
    const failures: SyncFailure[] = [];
    for (const merchant of merchants) {
      // One merchant's RPC error or parsing failure must not cost every
      // merchant after it in this run their turn (#135) — each is isolated
      // and logged with context, and the loop moves on.
      try {
        results.push(await runSync(merchant));
      } catch (error) {
        reportSyncError(error, merchant.address);
        failures.push({
          merchant: merchant.address,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return respond(results, failures);
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

  let merchant: Merchant | null = null;
  try {
    merchant = await withClient((client) => getMerchantFromRequest(client, request));
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return respond([await runSync(merchant, { cooldownMs: MANUAL_COOLDOWN_MS })]);
  } catch (error: unknown) {
    return failed(error, merchant?.address);
  }
}
