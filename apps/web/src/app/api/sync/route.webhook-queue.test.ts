import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Client } from 'pg';
import fixture from '@/lib/__fixtures__/sac-transfer-events.json';
import { GET } from './route';

const {
  MERCHANT,
  WEBHOOK_URL,
  mockWithClient,
  mockWithMerchantClient,
  mockGetLastSyncedLedger,
  mockSetLastSyncedLedger,
} = vi.hoisted(() => ({
  MERCHANT: 'GD4C3LWGIXNDWC3G2UTIKXA4TN2KCBOCP5G6R6YT6WBHVDEP4D4GRMK4',
  WEBHOOK_URL: 'https://merchant.example/hook',
  mockWithClient: vi.fn(),
  mockWithMerchantClient: vi.fn(),
  mockGetLastSyncedLedger: vi.fn(),
  mockSetLastSyncedLedger: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  withClient: mockWithClient,
  withMerchantClient: mockWithMerchantClient,
  ensureSchema: vi.fn(),
  getLastSyncedLedger: mockGetLastSyncedLedger,
  getSyncState: vi.fn().mockResolvedValue(null),
  setLastSyncedLedger: mockSetLastSyncedLedger,
  rollbackSyncToLedger: vi.fn(),
}));

vi.mock('@/lib/merchants', () => ({
  listMerchants: vi.fn().mockResolvedValue([{ id: 7, address: MERCHANT, webhookUrl: WEBHOOK_URL }]),
  getMerchantFromRequest: vi.fn(),
}));

vi.mock('@/lib/notifications/chatNotifier', () => ({ enqueueChatNotifications: vi.fn() }));
vi.mock('@/lib/sync-events', () => ({ hasSubscribers: () => false, broadcastSyncEvent: vi.fn() }));
vi.mock('@/lib/transaction-fees', () => ({
  createHorizonFeeFetcher: () => async () => null,
  resolveTransactionFees: async () => ({ fees: new Map(), unpriced: [] }),
}));

interface RecordedQuery {
  sql: string;
  params?: unknown[];
}

/**
 * Issue #506: the indexer must enqueue a delivery row in the payment-insert
 * transaction and never call the merchant from the sync path. The fake Postgres
 * records statement order so the transaction boundary is observable, and the
 * fetch stub hangs forever on the merchant URL: an inline delivery attempt would
 * therefore stall this sync window instead of letting the test finish.
 */
describe('sync webhook queue (#506)', () => {
  const originalFetch = globalThis.fetch;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalWebhookUrl = process.env.WEBHOOK_URL;
  let queries: RecordedQuery[];
  let fetchedUrls: string[];
  let returnedPayments: number;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://dummy';
    delete process.env.CRON_SECRET;
    delete process.env.WEBHOOK_URL;
    queries = [];
    fetchedUrls = [];
    returnedPayments = 0;

    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (sql.startsWith('INSERT INTO payments')) {
          const count = (sql.match(/\$\d+::numeric/g) ?? []).length;
          returnedPayments += count;
          return {
            rowCount: count,
            rows: Array.from({ length: count }, (_, i) => ({
              tx_hash: i.toString(16).padStart(64, '0'),
              ledger: fixture.events[0]!.ledger,
              payer: fixture.known.expected.from,
              amount: fixture.known.expected.amount,
              asset: fixture.known.expected.asset,
              ts: fixture.events[0]!.ledgerClosedAt,
              route: null,
              method: null,
            })),
          };
        }
        if (sql.startsWith('INSERT INTO webhook_deliveries')) {
          return { rowCount: 1, rows: [] };
        }
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as Client;

    mockWithClient.mockImplementation(async (callback: (db: Client) => unknown) =>
      callback(client),
    );
    mockWithMerchantClient.mockImplementation(
      async (_merchantId: number, callback: (db: Client) => unknown) => callback(client),
    );
    mockGetLastSyncedLedger.mockImplementation(async () => null);
    mockSetLastSyncedLedger.mockImplementation(async () => undefined);

    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      fetchedUrls.push(url);
      // A slow merchant endpoint: only the removed inline loop would await this.
      if (url === WEBHOOK_URL) return new Promise<Response>(() => {});
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'getLatestLedger') {
        return Promise.resolve(Response.json({ result: { sequence: fixture.events[0]!.ledger } }));
      }
      return Promise.resolve(Response.json({ result: { events: fixture.events } }));
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalWebhookUrl === undefined) delete process.env.WEBHOOK_URL;
    else process.env.WEBHOOK_URL = originalWebhookUrl;
  });

  test('enqueues inside the payment transaction and never waits on the merchant', async () => {
    const started = Date.now();
    const response = await Promise.race([
      GET(new Request('http://localhost/api/sync')),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('sync stalled on a merchant webhook')), 2_000);
      }),
    ]);
    const elapsed = Date.now() - started;

    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(2_000);
    expect(fetchedUrls).not.toContain(WEBHOOK_URL);

    const begin = queries.findIndex((q) => q.sql === 'BEGIN');
    const commit = queries.findIndex((q) => q.sql === 'COMMIT');
    const paymentInsert = queries.findIndex((q) => q.sql.startsWith('INSERT INTO payments'));
    const webhookInserts = queries.filter((q) =>
      q.sql.startsWith('INSERT INTO webhook_deliveries'),
    );

    expect(begin).toBeGreaterThanOrEqual(0);
    expect(paymentInsert).toBeGreaterThan(begin);
    expect(commit).toBeGreaterThan(paymentInsert);
    // One delivery row per payment actually written this window.
    expect(returnedPayments).toBeGreaterThan(0);
    expect(webhookInserts).toHaveLength(returnedPayments);

    // Every enqueue lands between BEGIN and COMMIT — the transaction that wrote
    // the payments — not after the commit where a rollback could orphan it.
    for (const insert of webhookInserts) {
      expect(queries.indexOf(insert)).toBeGreaterThan(paymentInsert);
      expect(queries.indexOf(insert)).toBeLessThan(commit);
      expect(insert.params?.[1]).toBe(WEBHOOK_URL);
      expect(JSON.parse(String(insert.params?.[2]))).toMatchObject({
        tx_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
    }

    const body = (await response.json()) as {
      success: boolean;
      results: Array<{ inserted: number }>;
    };
    expect(body.success).toBe(true);
    expect(body.results[0]?.inserted).toBe(returnedPayments);
  });
});
