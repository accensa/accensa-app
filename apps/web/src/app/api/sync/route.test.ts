import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Client } from 'pg';
import { GET } from './route';

const { mockWithClient, mockWithMerchantClient, mockGetLastSyncedLedger, mockSetLastSyncedLedger } =
  vi.hoisted(() => ({
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
  listMerchants: vi
    .fn()
    .mockResolvedValue([
      { id: 7, address: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H' },
    ]),
  getMerchantFromRequest: vi.fn(),
}));

vi.mock('@/lib/notifications/chatNotifier', () => ({ enqueueChatNotifications: vi.fn() }));
vi.mock('@/lib/sync-events', () => ({ hasSubscribers: () => false, broadcastSyncEvent: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('sync cursor locking', () => {
  const originalFetch = globalThis.fetch;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let cursor: number | null;
  let cursorWrites: number;
  let lockHeld: boolean;
  let lockWaiters: Array<() => void>;
  let firstEventsPage: ReturnType<typeof deferred<Response>>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://dummy';
    delete process.env.CRON_SECRET;
    cursor = null;
    cursorWrites = 0;
    lockHeld = false;
    lockWaiters = [];
    firstEventsPage = deferred<Response>();

    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT pg_advisory_lock')) {
          if (lockHeld) await new Promise<void>((resolve) => lockWaiters.push(resolve));
          lockHeld = true;
          return { rows: [] };
        }
        if (sql.startsWith('SELECT pg_advisory_unlock')) {
          lockHeld = false;
          lockWaiters.shift()?.();
          return { rows: [{ pg_advisory_unlock: true }] };
        }
        return { rows: [] };
      }),
    } as unknown as Client;

    mockWithClient.mockImplementation(async (callback: (db: Client) => unknown) =>
      callback(client),
    );
    mockWithMerchantClient.mockImplementation(
      async (_merchantId: number, callback: (db: Client) => unknown) => callback(client),
    );
    mockGetLastSyncedLedger.mockImplementation(async () => cursor);
    mockSetLastSyncedLedger.mockImplementation(async (_db, _merchantId, ledger: number) => {
      cursorWrites++;
      cursor = ledger;
    });

    let eventRequests = 0;
    globalThis.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'getLatestLedger') {
        return Response.json({ result: { sequence: 10 } });
      }
      eventRequests++;
      if (eventRequests === 1) return firstEventsPage.promise;
      return Response.json({ result: { events: [] } });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  test('an overlapping run waits and reads the cursor after the first run commits', async () => {
    const firstRun = GET(new Request('http://localhost/api/sync'));
    while (!lockHeld) await Promise.resolve();

    const secondRun = GET(new Request('http://localhost/api/sync'));
    await Promise.resolve();
    expect(mockGetLastSyncedLedger).toHaveBeenCalledTimes(0);

    firstEventsPage.resolve(Response.json({ result: { events: [] } }));
    const [firstResponse, secondResponse] = await Promise.all([firstRun, secondRun]);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(mockGetLastSyncedLedger).toHaveBeenCalledTimes(2);
    expect(cursorWrites).toBe(1);
    expect(cursor).toBe(10);
  });
});
