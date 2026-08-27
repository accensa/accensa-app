import { NextResponse } from 'next/server';
import { transferTopicFilter, addressTopicFilter } from '@/lib/stellar-events';
import {
  withClient,
  withMerchantClient,
  ensureSchema,
  getLastSyncedLedger,
  getSyncState,
  setLastSyncedLedger,
} from '@/lib/db';
import {
  sweepLedgerRange,
  parallelSweepLedgerRange,
  PARALLEL_SYNC_THRESHOLD,
  EVENTS_PAGE_LIMIT,
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
import { isAuthorizedCronRequest } from '@/lib/cron-auth';
import { createHmac } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RPC_URL = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';

/**
 * Stellar Asset Contracts whose `transfer` events represent revenue. Defaults
 * to the testnet native XLM SAC; set ASSET_CONTRACT_IDS to a comma-separated
 * list to settle in USDC or across multiple assets.
 */
const DEFAULT_ASSET_CONTRACT_IDS = (
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
 * Inserts `rows` in batches inside a single transaction.
 *
 * Mirrors `insertPaymentsInTransaction`'s batching but without advancing the
 * sync cursor: the streaming consumer calls this once per completed ledger
 * window, and the route advances the cursor to the sweep's final
 * `sweptThrough` afterwards. Each chunk commits atomically with the window —
 * if a chunk fails, the ROLLBACK discards the window's writes, and the cursor
 * is never moved because it is only written after the sweep. Webhooks are not
 * fired here; they run after COMMIT in the caller.
 *
 * @returns The RETURNING rows — exactly the payments inserted this window
 *   (conflicts skipped by the `WHERE ledger IS NULL` guard are not returned).
 */
async function insertPaymentRows(
  client: import('pg').Client,
  merchantId: number,
  rows: PaymentRow[],
): Promise<Record<string, unknown>[]> {
  await client.query('BEGIN');
  try {
    const payments: Record<string, unknown>[] = [];
    for (const chunk of chunkRows(rows, PAYMENTS_BATCH_SIZE)) {
      const res = await client.query<Record<string, unknown>>(
        buildBatchInsertSql(chunk.length),
        flattenRows(chunk),
      );
      payments.push(...res.rows);
    }
    await client.query('COMMIT');
    return payments;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

/**
 * Indexes Stellar Asset Contract transfers into one merchant's payment ledger.
 *
 * Shared by both entry points: the scheduled GET (looped over every merchant),
 * and the POST behind the dashboard's manual trigger (one merchant, the caller).
 * `cooldownMs`, when set, makes the run a no-op if the last sync is more recent
 * than that.
 */
async function runSync(merchant: Merchant, opts: { cooldownMs?: number } = {}) {
  return withMerchantClient(merchant.id, async (client) => {
    await ensureSchema(client);

    if (opts.cooldownMs) {
      const state = await getSyncState(client, merchant.id);
      const retryAfterMs = cooldownRemaining(state?.updatedAt, opts.cooldownMs);
      if (retryAfterMs > 0) return { cooldown: true, retryAfterMs } as CooldownResult;
    }

    {
      const { sequence: latestLedger } = await rpc<{ sequence: number }>('getLatestLedger', {});

      const cursor = await getLastSyncedLedger(client, merchant.id);
      const resumeFrom = cursor !== null ? cursor + 1 : latestLedger - COLD_START_LOOKBACK;
      const retentionFloor = latestLedger - MAX_LOOKBACK;
      const startLedger = Math.max(resumeFrom, retentionFloor, 1);

      // The clamp above is not free: when the cursor has fallen outside what the
      // RPC still serves, the ledgers in between are skipped and no later run can
      // recover them. Report the gap rather than let it vanish into a success.
      const skippedLedgers = Math.max(0, retentionFloor - resumeFrom);

      if (startLedger > latestLedger) {
        return {
          merchant: merchant.address,
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
      const toTopic = addressTopicFilter(merchant.address);
      const transfer = transferTopicFilter();
      const assetContractIds = merchant.assetContractIds ?? DEFAULT_ASSET_CONTRACT_IDS;
      const filters = [
        {
          type: 'contract',
          contractIds: assetContractIds,
          topics: [
            [transfer, '*', toTopic, '*'],
            [transfer, '*', toTopic],
          ],
        },
      ];

      // The limit belongs under `pagination`; sent at the top level the RPC
      // ignores it and applies its own default.
      const deadline = Date.now() + PAGING_BUDGET_MS;
      const fetchPage = ({
        startLedger: from,
        endLedger: to,
        cursor: pageCursor,
      }: {
        startLedger?: number;
        endLedger?: number;
        cursor?: string;
      }) =>
        rpc<EventPage>('getEvents', {
          ...(pageCursor ? {} : { startLedger: from, endLedger: to }),
          filters,
          pagination: {
            limit: EVENTS_PAGE_LIMIT,
            ...(pageCursor ? { cursor: pageCursor } : {}),
          },
          xdrFormat: 'base64',
        });

      const gap = latestLedger - startLedger + 1;
      const sweepFn = gap > PARALLEL_SYNC_THRESHOLD ? parallelSweepLedgerRange : sweepLedgerRange;
      let inserted = 0;
      let decoded = 0;

      // Streams each completed ledger window to an awaited consumer so the
      // whole catch-up backlog is never retained in memory. Upserts stay
      // sequential and deterministic because onEvents awaits before the sweep
      // advances to the next window.
      const { sweptThrough, complete, pages, windows, scanned } = await sweepFn(fetchPage, {
        startLedger,
        endLedger: latestLedger,
        withinBudget: () => Date.now() < deadline,
        onEvents: async (events: EventPage['events']) => {
          const webhookUrl = merchant.webhookUrl ?? process.env.WEBHOOK_URL;

          // Per-event filtering lives in eventsToPaymentRows: a malformed or
          // non-transfer event is skipped, and a transfer not addressed to this
          // merchant is never recorded. Only the insert below is batched —
          // batching must not quietly admit events that would have been filtered
          // out.
          const { rows, decoded: decodedCount } = eventsToPaymentRows(events, merchant);
          decoded += decodedCount;

          if (rows.length === 0) return;

          // Batch-insert the window's rows in one transaction. Since the sweep
          // only reports whole completed windows (sweptThrough), the cursor is
          // advanced separately below after the sweep resolves — never past a
          // window that may have been only partially drained.
          const payments = await insertPaymentRows(client, merchant.id, rows);
          inserted += payments.length;

          // Webhooks fire after COMMIT, so a slow or failing webhook can neither
          // hold the transaction open nor roll back a committed batch. The
          // returned rows are exactly the payments written this run.
          if (webhookUrl) {
            for (const payment of payments) {
              const body = JSON.stringify(payment);
              const webhookSecret = process.env.WEBHOOK_SECRET;
              const headers: Record<string, string> = { 'Content-Type': 'application/json' };
              if (webhookSecret) {
                headers['X-Webhook-Signature'] = createHmac('sha256', webhookSecret)
                  .update(body)
                  .digest('hex');
              }
              const timeoutMs = 2000;
              for (let i = 0; i < 3; i++) {
                try {
                  const controller = new AbortController();
                  const id = setTimeout(() => controller.abort(), timeoutMs);
                  const webhookRes = await fetch(webhookUrl, {
                    method: 'POST',
                    headers,
                    body,
                    signal: controller.signal,
                  });
                  clearTimeout(id);
                  if (webhookRes.ok || webhookRes.status < 500) break;
                } catch {
                  // A webhook the merchant cannot receive must not stall indexing.
                }
              }
            }
          }
        },
      });

      // The sweep only ever advances the cursor across whole completed
      // windows, so this is safe whether or not it reached the head. Crucially
      // it advances across empty windows too - a quiet merchant that never
      // moved the cursor is how the indexer fell behind the RPC retention
      // window and stopped seeing payments. Each merchant's cursor advances
      // independently, so one merchant with no activity cannot hold back or be
      // held back by another's progress.
      await setLastSyncedLedger(client, merchant.id, sweptThrough);

      return {
        merchant: merchant.address,
        latestLedger,
        startLedger,
        syncedTo: sweptThrough,
        skippedLedgers,
        drained: complete,
        pages,
        windows,
        scanned,
        decoded,
        inserted,
      };
    }
  });
}

type SyncResult = Awaited<ReturnType<typeof runSync>>;

/** Maps one merchant's run to its response fragment. */
function summarize(result: SyncResult) {
  if ('cooldown' in result) {
    return { cooldown: true, retryAfterMs: Math.ceil(result.retryAfterMs) };
  }
  return result;
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
 */
function respond(results: SyncResult[]) {
  // The manual, single-merchant POST path preserves the original 429 +
  // Retry-After contract exactly, since the dashboard's "Sync now" button
  // already depends on it.
  if (results.length === 1 && 'cooldown' in results[0]) {
    const retryAfterMs = Math.ceil(results[0].retryAfterMs);
    return NextResponse.json(
      { success: true, cooldown: true, retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  const summaries = results.map(summarize);
  const synced = summaries.filter(
    (s): s is Extract<(typeof summaries)[number], { syncedTo: number }> => 'syncedTo' in s,
  );
  const syncedTo = synced.length ? Math.max(...synced.map((s) => s.syncedTo)) : null;
  const skippedLedgers = synced.length ? Math.max(...synced.map((s) => s.skippedLedgers)) : 0;
  const drained = synced.length ? synced.every((s) => s.drained) : true;

  return NextResponse.json({
    success: true,
    results: summaries,
    ...(syncedTo !== null ? { syncedTo, skippedLedgers, drained } : {}),
  });
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
 *
 * Sweeps every configured merchant in turn, each with its own cursor - a
 * merchant with no activity still has its cursor advanced (see runSync),
 * which is precisely the fix for the outage that motivated this workflow's
 * checks in the first place.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && !isAuthorizedCronRequest(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }

  try {
    const merchants = await withClient(async (client) => {
      await ensureSchema(client);
      return listMerchants(client);
    });

    if (merchants.length === 0) {
      return NextResponse.json({ error: 'No merchants are configured' }, { status: 500 });
    }

    const results: SyncResult[] = [];
    for (const merchant of merchants) {
      results.push(await runSync(merchant));
    }
    return respond(results);
  } catch (error: unknown) {
    return failed(error);
  }
}

/**
 * Manual entry point, behind the dashboard's"Sync now"button.
 *
 * Protected by session authentication via middleware, which resolves to
 * exactly the merchant that owns this dashboard session — a signed-in
 * merchant can only trigger their own sync. MANUAL_COOLDOWN_MS bounds the cost.
 */
export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }

  try {
    const merchant = await withClient((client) => getMerchantFromRequest(client, request));
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return respond([await runSync(merchant, { cooldownMs: MANUAL_COOLDOWN_MS })]);
  } catch (error: unknown) {
    return failed(error);
  }
}
