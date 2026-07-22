import { NextResponse } from 'next/server';
import {
  decodeTransferEvent,
  transferTopicFilter,
  addressTopicFilter,
  type RawEvent,
} from '@/lib/stellar-events';
import {
  withClient,
  ensureSchema,
  getLastSyncedLedger,
  setLastSyncedLedger,
} from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RPC_URL = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';

/**
 * Stellar Asset Contracts whose `transfer` events represent revenue. Defaults
 * to the testnet native XLM SAC; set ASSET_CONTRACT_IDS to a comma-separated
 * list to settle in USDC or across multiple assets.
 */
const ASSET_CONTRACT_IDS = (
  process.env.ASSET_CONTRACT_IDS ??
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Ledgers to look back on a cold start, when no cursor has been stored yet. */
const COLD_START_LOOKBACK = 2_000;

/** Soroban RPC retains only a limited window of ledgers for getEvents. */
const MAX_LOOKBACK = 100_000;

async function rpc<T>(method: string, params: unknown): Promise<T> {
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
}

/**
 * Indexes Stellar Asset Contract transfers into the merchant's payment ledger.
 *
 * Invoked by Vercel Cron. Protected by CRON_SECRET when set — Vercel sends it
 * as a bearer token — so the endpoint cannot be driven by arbitrary callers.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const merchant = process.env.MERCHANT_ADDRESS;
  if (!merchant) {
    return NextResponse.json({ error: 'MERCHANT_ADDRESS is not configured' }, { status: 500 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }

  try {
    const result = await withClient(async (client) => {
      await ensureSchema(client);

      const { sequence: latestLedger } = await rpc<{ sequence: number }>('getLatestLedger', {});

      const cursor = await getLastSyncedLedger(client);
      const startLedger = Math.max(
        cursor !== null ? cursor + 1 : latestLedger - COLD_START_LOOKBACK,
        latestLedger - MAX_LOOKBACK,
        1,
      );

      if (startLedger > latestLedger) {
        return { latestLedger, startLedger, scanned: 0, decoded: 0, inserted: 0 };
      }

      // Filter server-side to transfers addressed to this merchant. The asset
      // topic is optional across protocol versions, so match both arities.
      const toTopic = addressTopicFilter(merchant);
      const transfer = transferTopicFilter();
      const { events } = await rpc<{ events: RawEvent[] }>('getEvents', {
        startLedger,
        filters: [
          {
            type: 'contract',
            contractIds: ASSET_CONTRACT_IDS,
            topics: [
              [transfer, '*', toTopic, '*'],
              [transfer, '*', toTopic],
            ],
          },
        ],
        limit: 200,
        xdrFormat: 'base64',
      });

      let inserted = 0;
      let decoded = 0;
      let maxLedger = startLedger - 1;

      for (const event of events) {
        const transferEvent = decodeTransferEvent(event);
        // A malformed or non-transfer event must not stall the batch.
        if (!transferEvent) continue;
        decoded++;
        maxLedger = Math.max(maxLedger, transferEvent.ledger);

        // Defensive: never record a transfer that is not to this merchant.
        if (transferEvent.to !== merchant) continue;

        const res = await client.query(
          `INSERT INTO payments (tx_hash, ledger, payer, amount, asset, ts)
           VALUES ($1, $2, $3, $4::numeric, $5, $6::timestamptz)
           ON CONFLICT (tx_hash) DO NOTHING`,
          [
            transferEvent.txHash,
            transferEvent.ledger,
            transferEvent.from,
            transferEvent.amount, // string — never a float
            transferEvent.asset,
            transferEvent.ledgerClosedAt,
          ],
        );
        inserted += res.rowCount ?? 0;
      }

      // Only advance the cursor across the range actually examined.
      await setLastSyncedLedger(client, Math.max(maxLedger, startLedger - 1));

      return { latestLedger, startLedger, scanned: events.length, decoded, inserted };
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
