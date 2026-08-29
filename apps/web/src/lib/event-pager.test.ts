import { describe, it, expect } from 'vitest';
import {
  drainEvents,
  sweepLedgerRange,
  parallelSweepLedgerRange,
  EVENTS_PAGE_LIMIT,
  LEDGER_WINDOW,
  LedgerWindowFetchError,
  type EventPage,
} from './event-pager';
import type { RawEvent } from './stellar-events';

/** Builds `count` events spread across ledgers, ids ascending from `from`. */
function makeEvents(count: number, ledgerOf: (i: number) => number, from = 0): RawEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `evt-${from + i}`,
    txHash: `tx-${from + i}`,
    ledger: ledgerOf(from + i),
  }));
}

/** A fake RPC that serves a fixed event list in pages of EVENTS_PAGE_LIMIT. */
function pagedSource(all: RawEvent[], opts: { omitCursor?: boolean } = {}) {
  const calls: Array<{ startLedger?: number; cursor?: string }> = [];
  const fetchPage = async (params: {
    startLedger?: number;
    cursor?: string;
  }): Promise<EventPage> => {
    calls.push(params);
    const offset = params.cursor ? all.findIndex((e) => e.id === params.cursor) + 1 : 0;
    const events = all.slice(offset, offset + EVENTS_PAGE_LIMIT);
    const cursor = events.length ? events[events.length - 1].id : undefined;
    return opts.omitCursor ? { events } : { events, cursor };
  };
  return { fetchPage, calls };
}

describe('drainEvents', () => {
  it('returns a single short page without asking for more', async () => {
    const { fetchPage, calls } = pagedSource(makeEvents(4, () => 100));

    const result = await drainEvents(fetchPage, { startLedger: 100 });

    expect(result.events).toHaveLength(4);
    expect(result.drained).toBe(true);
    expect(result.pages).toBe(1);
    expect(calls).toEqual([{ startLedger: 100 }]);
  });

  it('follows the cursor across every page', async () => {
    // 512 events => 200 + 200 + 112, i.e. three pages.
    const all = makeEvents(512, (i) => 100 + Math.floor(i / 10));
    const { fetchPage, calls } = pagedSource(all);

    const result = await drainEvents(fetchPage, { startLedger: 100 });

    expect(result.events).toHaveLength(512);
    expect(result.pages).toBe(3);
    expect(result.drained).toBe(true);
    // The first call ranges by ledger, every later one by cursor - never both.
    expect(calls[0]).toEqual({ startLedger: 100 });
    expect(calls[1]).toEqual({ cursor: 'evt-199' });
    expect(calls[2]).toEqual({ cursor: 'evt-399' });
  });

  it('does not drop events that straddle a page boundary', async () => {
    // Every event sits in ledger 500, so a naive single-page read would take
    // 200 of them and then advance the sync cursor past ledger 500 entirely.
    const all = makeEvents(250, () => 500);
    const { fetchPage } = pagedSource(all);

    const result = await drainEvents(fetchPage, { startLedger: 500 });

    expect(result.events).toHaveLength(250);
    expect(result.events.map((e) => e.txHash)).toContain('tx-249');
  });

  it('falls back to the last event id when the page carries no cursor', async () => {
    const all = makeEvents(300, () => 100);
    const { fetchPage, calls } = pagedSource(all, { omitCursor: true });

    const result = await drainEvents(fetchPage, { startLedger: 100 });

    expect(result.events).toHaveLength(300);
    expect(calls[1]).toEqual({ cursor: 'evt-199' });
  });

  it('stops on a full page that yields no cursor, rather than looping', async () => {
    const fetchPage = async (): Promise<EventPage> => ({
      events: Array.from({ length: EVENTS_PAGE_LIMIT }, () => ({ ledger: 1 })),
    });

    const result = await drainEvents(fetchPage, { startLedger: 1 });

    expect(result.pages).toBe(1);
    expect(result.events).toHaveLength(EVENTS_PAGE_LIMIT);
  });

  it('reports a partial read when the budget runs out', async () => {
    const all = makeEvents(1000, (i) => 100 + i);
    const { fetchPage } = pagedSource(all);
    let calls = 0;

    const result = await drainEvents(fetchPage, {
      startLedger: 100,
      withinBudget: () => ++calls < 2,
    });

    expect(result.drained).toBe(false);
    expect(result.pages).toBe(2);
    expect(result.events).toHaveLength(400);
  });

  it('wraps a failed fetch in a LedgerWindowFetchError carrying the window (#135)', async () => {
    const rpcError = new Error('RPC getEvents: [-32001] request exceeded processing limit');
    const fetchPage = async (): Promise<EventPage> => {
      throw rpcError;
    };

    await expect(
      drainEvents(fetchPage, { startLedger: 12_345, endLedger: 22_345 }),
    ).rejects.toThrow(LedgerWindowFetchError);

    try {
      await drainEvents(fetchPage, { startLedger: 12_345, endLedger: 22_345 });
      expect.unreachable('drainEvents should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(LedgerWindowFetchError);
      const wrapped = error as LedgerWindowFetchError;
      expect(wrapped.startLedger).toBe(12_345);
      expect(wrapped.endLedger).toBe(22_345);
      expect(wrapped.cause).toBe(rpcError);
      expect(wrapped.message).toContain('12345');
      expect(wrapped.message).toContain('22345');
    }
  });

  it('falls back to startLedger for the window end when a later page has no endLedger', async () => {
    // A cursor-following page omits endLedger entirely (see the "supersedes
    // startLedger" comment above) — a failure there must still report a
    // sensible window rather than an undefined endLedger.
    const all = makeEvents(EVENTS_PAGE_LIMIT + 1, () => 100);
    let calls = 0;
    const fetchPage = async (): Promise<EventPage> => {
      calls++;
      if (calls === 1) {
        return { events: all.slice(0, EVENTS_PAGE_LIMIT), cursor: 'evt-199' };
      }
      throw new Error('second page failed');
    };

    try {
      await drainEvents(fetchPage, { startLedger: 100 });
      expect.unreachable('drainEvents should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(LedgerWindowFetchError);
      expect((error as LedgerWindowFetchError).startLedger).toBe(100);
      expect((error as LedgerWindowFetchError).endLedger).toBe(100);
    }
  });
});

/**
 * A fake RPC that honours the ledger window, the way Soroban RPC does.
 *
 * Deliberately returns nothing for events outside `[startLedger, endLedger]`:
 * the bug this guards against is a caller assuming an unbounded request was
 * answered in full.
 */
function windowedSource(all: RawEvent[]) {
  const windows: Array<{ startLedger?: number; endLedger?: number }> = [];
  const fetchPage = async (params: {
    startLedger?: number;
    endLedger?: number;
    cursor?: string;
  }): Promise<EventPage> => {
    if (!params.cursor)
      windows.push({ startLedger: params.startLedger, endLedger: params.endLedger });
    const from = params.startLedger ?? 0;
    const to = params.endLedger ?? Number.MAX_SAFE_INTEGER;
    const inRange = all.filter((e) => (e.ledger ?? 0) >= from && (e.ledger ?? 0) <= to);
    const offset = params.cursor ? inRange.findIndex((e) => e.id === params.cursor) + 1 : 0;
    const events = inRange.slice(offset, offset + EVENTS_PAGE_LIMIT);
    return { events, cursor: events.length ? events[events.length - 1].id : undefined };
  };
  return { fetchPage, windows };
}

describe('sweepLedgerRange', () => {
  it('covers the whole range in windows the RPC will honour', async () => {
    const { fetchPage, windows } = windowedSource([]);

    const result = await sweepLedgerRange(fetchPage, {
      startLedger: 1_000,
      endLedger: 1_000 + LEDGER_WINDOW * 2,
    });

    expect(result.complete).toBe(true);
    expect(result.sweptThrough).toBe(1_000 + LEDGER_WINDOW * 2);
    expect(result.windows).toBe(3);
    // Contiguous, non-overlapping, and never wider than one window.
    expect(windows[0]).toEqual({ startLedger: 1_000, endLedger: 1_000 + LEDGER_WINDOW - 1 });
    expect(windows[1].startLedger).toBe(windows[0].endLedger! + 1);
    expect(windows[2].endLedger).toBe(1_000 + LEDGER_WINDOW * 2);
  });

  it('advances through a range that held no events at all', async () => {
    // The regression that stranded the indexer. A quiet merchant used to leave
    // the cursor where it was, so the gap to the chain head grew until it passed
    // the RPC retention window and new payments stopped being seen entirely.
    const { fetchPage } = windowedSource([]);

    const result = await sweepLedgerRange(fetchPage, { startLedger: 500, endLedger: 40_000 });

    expect(result.events).toHaveLength(0);
    expect(result.sweptThrough).toBe(40_000);
    expect(result.complete).toBe(true);
  });

  it('finds an event that a single unbounded request would have missed', async () => {
    // The event sits near the head, far past what one getEvents call scans.
    const { fetchPage } = windowedSource(makeEvents(1, () => 99_000));

    const result = await sweepLedgerRange(fetchPage, { startLedger: 1, endLedger: 100_000 });

    expect(result.events.map((e) => e.ledger)).toEqual([99_000]);
    expect(result.complete).toBe(true);
  });

  it('stops on a window boundary when the budget runs out', async () => {
    const { fetchPage } = windowedSource([]);
    let calls = 0;

    const result = await sweepLedgerRange(fetchPage, {
      startLedger: 1,
      endLedger: 100_000,
      withinBudget: () => ++calls <= 2,
    });

    expect(result.complete).toBe(false);
    // Two windows cleared before the budget went. The cursor lands on that
    // boundary, so the next run resumes cleanly rather than inside a window it
    // only partly read.
    expect(result.sweptThrough).toBe(LEDGER_WINDOW * 2);
    expect(result.windows).toBe(2);
  });

  it('makes no progress when the budget runs out before the first window', async () => {
    const { fetchPage } = windowedSource([]);

    const result = await sweepLedgerRange(fetchPage, {
      startLedger: 5_000,
      endLedger: 100_000,
      withinBudget: () => false,
    });

    expect(result.complete).toBe(false);
    expect(result.sweptThrough).toBe(4_999);
    expect(result.windows).toBe(0);
  });

  it('never advances past a window it did not finish', async () => {
    // 250 events in one ledger: the window needs two pages, and the budget dies
    // between them. The cursor must not step over the half it never read.
    const { fetchPage } = windowedSource(makeEvents(250, () => 2_000));
    let calls = 0;

    const result = await sweepLedgerRange(fetchPage, {
      startLedger: 1,
      endLedger: 100_000,
      withinBudget: () => ++calls <= 1,
    });

    expect(result.complete).toBe(false);
    expect(result.sweptThrough).toBe(0);
  });
});

describe('parallelSweepLedgerRange', () => {
  it('fetches multiple windows concurrently within the configured limit', async () => {
    const { fetchPage: source } = windowedSource([]);
    let active = 0;
    let maxActive = 0;
    const fetchPage = async (params: {
      startLedger?: number;
      endLedger?: number;
      cursor?: string;
    }): Promise<EventPage> => {
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return await source(params);
      } finally {
        active--;
      }
    };

    const result = await parallelSweepLedgerRange(fetchPage, {
      startLedger: 1_000,
      endLedger: 1_000 + LEDGER_WINDOW * 3 - 1,
      concurrency: 3,
    });

    expect(result.complete).toBe(true);
    expect(result.sweptThrough).toBe(1_000 + LEDGER_WINDOW * 3 - 1);
    expect(result.windows).toBe(3);
    expect(maxActive).toBe(3);
    expect(result.events).toHaveLength(0);
  });

  it('covers the whole range and advances cursor through all windows', async () => {
    const events = makeEvents(5, (i) => 500 + i);
    const { fetchPage } = windowedSource(events);

    const result = await parallelSweepLedgerRange(fetchPage, {
      startLedger: 1,
      endLedger: LEDGER_WINDOW * 2 + 100,
      concurrency: 10,
    });

    expect(result.complete).toBe(true);
    expect(result.events).toHaveLength(5);
    expect(result.events.map((e) => e.ledger)).toEqual([500, 501, 502, 503, 504]);
  });

  it('finds events spread across parallel windows', async () => {
    // Events at ledger 500 (window 0) and 50_000 (window 5).
    const events = [...makeEvents(1, () => 500), ...makeEvents(1, () => 50_000)];
    const { fetchPage } = windowedSource(events);

    const result = await parallelSweepLedgerRange(fetchPage, {
      startLedger: 1,
      endLedger: 100_000,
      concurrency: 10,
    });

    expect(result.complete).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.events.map((e) => e.ledger)).toEqual([500, 50_000]);
  });

  it('respects the budget between parallel batches', async () => {
    const { fetchPage } = windowedSource([]);
    let checks = 0;

    // The first batch completes; the next budget check stops before fetching
    // another batch. Each batch contains two windows.
    const result = await parallelSweepLedgerRange(fetchPage, {
      startLedger: 1,
      endLedger: LEDGER_WINDOW * 4,
      concurrency: 2,
      withinBudget: () => ++checks <= 1,
    });

    expect(result.complete).toBe(false);
    expect(result.sweptThrough).toBe(LEDGER_WINDOW * 2);
  });

  it('emits fetched windows in ledger order after concurrent completion', async () => {
    const events = [...makeEvents(1, () => 50_000), ...makeEvents(1, () => 500)];
    const { fetchPage: source } = windowedSource(events);
    const committed: number[] = [];
    const fetchPage = async (params: {
      startLedger?: number;
      endLedger?: number;
      cursor?: string;
    }): Promise<EventPage> => {
      const page = await source(params);
      if (params.startLedger === 1) await new Promise((resolve) => setTimeout(resolve, 10));
      return page;
    };

    const result = await parallelSweepLedgerRange(fetchPage, {
      startLedger: 1,
      endLedger: LEDGER_WINDOW * 5,
      concurrency: 10,
      onEvents: async (batch) => {
        committed.push(...batch.map((event) => event.ledger ?? 0));
      },
    });

    expect(result.events).toHaveLength(0);
    expect(result.scanned).toBe(2);
    expect(committed).toEqual([500, 50_000]);
  });

  it('advances through a range with no events', async () => {
    const { fetchPage } = windowedSource([]);

    const result = await parallelSweepLedgerRange(fetchPage, {
      startLedger: 1,
      endLedger: LEDGER_WINDOW * 5,
      concurrency: 10,
    });

    expect(result.events).toHaveLength(0);
    expect(result.sweptThrough).toBe(LEDGER_WINDOW * 5);
    expect(result.complete).toBe(true);
  });

  it('returns partial progress when budget runs out before first batch', async () => {
    const { fetchPage } = windowedSource([]);

    const result = await parallelSweepLedgerRange(fetchPage, {
      startLedger: 5_000,
      endLedger: 100_000,
      concurrency: 10,
      withinBudget: () => false,
    });

    expect(result.complete).toBe(false);
    expect(result.sweptThrough).toBe(4_999);
    expect(result.windows).toBe(0);
  });

  it('handles a single window gracefully', async () => {
    const events = makeEvents(3, () => 42);
    const { fetchPage } = windowedSource(events);

    const result = await parallelSweepLedgerRange(fetchPage, {
      startLedger: 1,
      endLedger: 100,
      concurrency: 10,
    });

    expect(result.complete).toBe(true);
    expect(result.events).toHaveLength(3);
    expect(result.windows).toBe(1);
  });

  it('default concurrency matches the exported constant', async () => {
    const { PARALLEL_CONCURRENCY } = await import('./event-pager');
    expect(PARALLEL_CONCURRENCY).toBe(10);
  });
});
