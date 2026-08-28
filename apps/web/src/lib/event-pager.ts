import type { RawEvent } from './stellar-events';

/** Events requested per `getEvents` call. The RPC caps this server-side. */
export const EVENTS_PAGE_LIMIT = 200;

/** One page of `getEvents` output. */
export interface EventPage {
  events: RawEvent[];
  /** Opaque cursor for the next page. Absent once the range is exhausted. */
  cursor?: string;
}

export type EventConsumer = (events: RawEvent[]) => void | Promise<void>;

/**
 * Thrown when a `getEvents` page fetch fails, carrying the exact ledger window
 * that was being read at the time (#135). Without this, an RPC error or a
 * parsing failure bubbles up as a bare error with no way to tell which ledgers
 * were affected — the window is only ever in scope at the call site below.
 */
export class LedgerWindowFetchError extends Error {
  readonly startLedger: number;
  readonly endLedger: number;

  constructor(startLedger: number, endLedger: number, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to fetch events for ledger window [${startLedger}, ${endLedger}]: ${reason}`, {
      cause,
    });
    this.name = 'LedgerWindowFetchError';
    this.startLedger = startLedger;
    this.endLedger = endLedger;
  }
}

export interface DrainResult {
  events: RawEvent[];
  /**
   * True when the range was consumed to the end. False when paging stopped
   * early against the deadline, which means the final ledger seen may be only
   * partially consumed and the sync cursor must not advance past it.
   */
  drained: boolean;
  /** Number of RPC round trips made. */
  pages: number;
}

/**
 * Ledgers covered by a single `getEvents` request.
 *
 * Soroban RPC bounds how much history one call will scan, and it does not fail
 * loudly when a range exceeds that bound: asked for 100,000 ledgers it returns
 * an empty page with a cursor, or `[-32001] request exceeded processing limit
 * threshold`, depending on load. An empty page is indistinguishable from"no
 * payments here", which is how a backlog turns into silent data loss. Every
 * request is therefore bounded to a window the RPC will actually scan.
 *
 * Measured against testnet: 10,000 ledgers answers in ~3.4s, and a 45s budget
 * covers more than the RPC's whole retention window in one invocation.
 */
export const LEDGER_WINDOW = 10_000;

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? Math.floor(value!) : fallback;
}

/**
 * Reads every page of one bounded `getEvents` window.
 *
 * `getEvents` returns at most one page per call. Taking only the first page and
 * then advancing the sync cursor past it silently discards the remainder --
 * payments that exist on chain but never reach the merchant's ledger. So this
 * follows the cursor until the window is exhausted.
 *
 * `withinBudget` bounds the work: a serverless invocation has a wall clock
 * limit, and a busy window can exceed it. When the budget runs out mid-window
 * the caller is told, via `drained: false`, that it is holding a partial result.
 */
export async function drainEvents(
  fetchPage: (params: {
    startLedger?: number;
    endLedger?: number;
    cursor?: string;
  }) => Promise<EventPage>,
  opts: { startLedger: number; endLedger?: number; withinBudget?: () => boolean },
): Promise<DrainResult> {
  const { startLedger, endLedger, withinBudget } = opts;
  const events: RawEvent[] = [];
  let cursor: string | undefined;
  let pages = 0;

  for (;;) {
    // A cursor supersedes startLedger; sending both is rejected by the RPC.
    let page: EventPage;
    try {
      page = await fetchPage(cursor ? { cursor } : { startLedger, endLedger });
    } catch (cause) {
      throw new LedgerWindowFetchError(startLedger, endLedger ?? startLedger, cause);
    }
    pages++;
    events.push(...page.events);

    // Within a bounded window a short page really does mean exhausted. Trusting
    // the cursor alone would loop forever against an RPC that always returns one.
    if (page.events.length < EVENTS_PAGE_LIMIT) return { events, drained: true, pages };

    const next = page.cursor ?? page.events[page.events.length - 1]?.id;
    if (!next) return { events, drained: true, pages };
    cursor = next;

    if (withinBudget && !withinBudget()) return { events, drained: false, pages };
  }
}

export interface SweepResult {
  /** Events returned when no `onEvents` consumer is supplied. */
  events: RawEvent[];
  /** Total events fetched, including events delivered to `onEvents`. */
  scanned: number;
  /**
   * The last ledger known to be fully consumed, and so the furthest the sync
   * cursor may advance. Only ever a completed window boundary, so it is safe
   * whether or not the sweep finished.
   */
  sweptThrough: number;
  /** True when the sweep reached `endLedger` rather than stopping on budget. */
  complete: boolean;
  pages: number;
  windows: number;
}

/**
 * Sweeps `[startLedger, endLedger]` in windows the RPC will honour.
 *
 * The cursor advances only across whole windows. A window abandoned against the
 * budget contributes its events -- the payments upsert is idempotent, so they
 * cost nothing to see twice -- but never moves `sweptThrough`, so the next run
 * re-reads it from the start rather than stepping over the part it never saw.
 */
export async function sweepLedgerRange(
  fetchPage: (params: {
    startLedger?: number;
    endLedger?: number;
    cursor?: string;
  }) => Promise<EventPage>,
  opts: {
    startLedger: number;
    endLedger: number;
    windowSize?: number;
    withinBudget?: () => boolean;
    /** Called for each window in ledger order before the cursor advances. */
    onEvents?: EventConsumer;
  },
): Promise<SweepResult> {
  const { startLedger, endLedger, withinBudget, onEvents } = opts;
  const windowSize = positiveInteger(opts.windowSize, LEDGER_WINDOW);
  const events: RawEvent[] = [];
  let scanned = 0;
  const emit = async (windowEvents: RawEvent[]) => {
    scanned += windowEvents.length;
    if (onEvents) {
      await onEvents(orderEvents(windowEvents));
    } else {
      events.push(...orderEvents(windowEvents));
    }
  };
  let sweptThrough = startLedger - 1;
  let pages = 0;
  let windows = 0;

  while (sweptThrough < endLedger) {
    if (withinBudget && !withinBudget()) {
      return { events, scanned, sweptThrough, complete: false, pages, windows };
    }

    const from = sweptThrough + 1;
    const to = Math.min(from + windowSize - 1, endLedger);
    const window = await drainEvents(fetchPage, {
      startLedger: from,
      endLedger: to,
      withinBudget,
    });

    windows++;
    pages += window.pages;

    if (!window.drained) {
      await emit(window.events);
      return { events, scanned, sweptThrough, complete: false, pages, windows };
    }
    await emit(window.events);
    sweptThrough = to;
  }

  return { events, scanned, sweptThrough, complete: true, pages, windows };
}

/**
 * Gap in ledgers that triggers parallel fetching instead of sequential.
 *
 * Below this threshold the overhead of coordinating parallel fetches is not
 * worth the cost; above it the RPC round-trip savings dominate.
 */
export const PARALLEL_SYNC_THRESHOLD = LEDGER_WINDOW;

/** Maximum number of ledger windows fetched concurrently. */
export const PARALLEL_CONCURRENCY = 10;

/**
 * Keeps commits deterministic even when an RPC returns same-ledger events in
 * an unexpected order. The sort is stable in modern runtimes, and the id tie
 * breaker makes the intended order explicit for test doubles and retries.
 */
function orderEvents(events: RawEvent[]): RawEvent[] {
  return [...events].sort((a, b) => {
    const ledgerDifference = (a.ledger ?? 0) - (b.ledger ?? 0);
    if (ledgerDifference !== 0) return ledgerDifference;
    return (a.id ?? '').localeCompare(b.id ?? '');
  });
}

/**
 * Fetches page from the RPC for one ledger window.
 *
 * Extracted so it can be called from `Promise.all` without closures.
 */
async function fetchWindow(
  fetchPage: (params: {
    startLedger?: number;
    endLedger?: number;
    cursor?: string;
  }) => Promise<EventPage>,
  startLedger: number,
  endLedger: number,
  withinBudget?: () => boolean,
): Promise<DrainResult> {
  return drainEvents(fetchPage, { startLedger, endLedger, withinBudget });
}

/**
 * Sweeps `[startLedger, endLedger]` using parallel window fetches.
 *
 * Identical contract to `sweepLedgerRange` -- same return type, same cursor
 * semantics, same budget behaviour -- but fetches up to `concurrency` ledger
 * windows in parallel instead of one at a time.  This dramatically reduces
 * wall-clock time when the indexer must catch up after extended downtime.
 *
 * Events are emitted in window order through `onEvents`, after all fetches in
 * the current batch have resolved. Awaiting that callback before advancing to
 * the next window makes sequential database commits explicit. Without a
 * callback, events are returned in the same order for callers that want to
 * process them after the sweep.
 *
 * If any window in a batch fails to drain (budget exhausted or RPC error), the
 * cursor advances only through the windows that completed successfully. Events
 * from the incomplete window are emitted too, but later windows are discarded
 * and will be fetched again on the next run.
 */
export async function parallelSweepLedgerRange(
  fetchPage: (params: {
    startLedger?: number;
    endLedger?: number;
    cursor?: string;
  }) => Promise<EventPage>,
  opts: {
    startLedger: number;
    endLedger: number;
    windowSize?: number;
    concurrency?: number;
    withinBudget?: () => boolean;
    /** Called for each completed window in ledger order. */
    onEvents?: EventConsumer;
  },
): Promise<SweepResult> {
  const { startLedger, endLedger, withinBudget, onEvents } = opts;
  const windowSize = positiveInteger(opts.windowSize, LEDGER_WINDOW);
  const batchSize = positiveInteger(opts.concurrency, PARALLEL_CONCURRENCY);

  const events: RawEvent[] = [];
  let scanned = 0;
  const emit = async (windowEvents: RawEvent[]) => {
    scanned += windowEvents.length;
    if (onEvents) {
      await onEvents(orderEvents(windowEvents));
    } else {
      events.push(...orderEvents(windowEvents));
    }
  };
  let nextWindowStart = startLedger;
  let sweptThrough = startLedger - 1;
  let pages = 0;
  let windows = 0;

  while (nextWindowStart <= endLedger) {
    if (withinBudget && !withinBudget()) {
      return { events, scanned, sweptThrough, complete: false, pages, windows };
    }

    const batch: Array<{ from: number; to: number }> = [];
    while (batch.length < batchSize && nextWindowStart <= endLedger) {
      const from = nextWindowStart;
      const to = Math.min(from + windowSize - 1, endLedger);
      batch.push({ from, to });
      nextWindowStart = to + 1;
    }

    // Fetch every window in this batch concurrently.  Promise.all is used
    // rather than allSettled: an RPC failure after retries should abort the
    // run so the cursor does not advance past a gap the caller never saw.
    const results = await Promise.all(
      batch.map((range) => fetchWindow(fetchPage, range.from, range.to, withinBudget)),
    );

    // Advance the cursor through completed windows in order.  Stop at the
    // first window that did not fully drain -- later windows in the same
    // batch may have fetched events too, but the cursor must not skip over
    // unread ranges.
    let batchFailed = false;
    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      pages += result.pages;

      if (!result.drained) {
        batchFailed = true;
        // Emit events already returned by the partial window. The consumer's
        // writes are idempotent, so the next run can safely retry the window.
        await emit(result.events);
        break;
      }

      await emit(result.events);
      sweptThrough = batch[j].to;
      windows++;
    }

    if (batchFailed) break;
  }

  return {
    events,
    scanned,
    sweptThrough,
    complete: sweptThrough >= endLedger,
    pages,
    windows,
  };
}
