import type { PaymentRow, PaymentsResponse } from '@/app/api/payments/route';
import type { SyncState } from '@/lib/sync-status';

/**
 * Pulls the *complete* payment history from `/api/payments`, following its
 * `next_cursor` page by page.
 *
 * `/api/payments` returns at most 1,000 rows per request. A single call is fine
 * for the settlements table, which only ever shows the newest page — but the
 * analytics views aggregate over a whole date range, and reading one page there
 * silently computes "all time" from the newest 1,000 payments. This walks the
 * cursor to the end so the numbers cover what they claim to.
 */

/** The largest page `/api/payments` will serve. */
const PAGE_SIZE = 1000;

/**
 * Hard ceiling on pages, so a server bug that returns a non-advancing cursor
 * cannot spin forever. 1,000 pages is a million payments — far past any realistic
 * merchant history, and if it is ever hit the caller is told rather than shown a
 * quietly truncated total.
 */
const MAX_PAGES = 1000;

export interface PaymentHistory {
  payments: PaymentRow[];
  /** From the first page; null until the indexer has run at least once. */
  sync: SyncState | null;
  /** True if {@link MAX_PAGES} was reached before the cursor ran out. */
  truncated: boolean;
}

export interface FetchAllPaymentsOptions {
  signal?: AbortSignal;
  /** Called after each page with the running total, for a progress indicator. */
  onProgress?: (loaded: number) => void;
  /** Overridable for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export async function fetchAllPayments(
  options: FetchAllPaymentsOptions = {},
): Promise<PaymentHistory> {
  const doFetch = options.fetchImpl ?? fetch;
  const payments: PaymentRow[] = [];
  let cursor: string | null = null;
  let sync: SyncState | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) query.set('cursor', cursor);

    const res = await doFetch(`/api/payments?${query}`, {
      signal: options.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      const message = await res
        .json()
        .then((body: { error?: string }) => body.error)
        .catch(() => null);
      throw new Error(message ?? `Request failed: ${res.status}`);
    }

    const body: PaymentsResponse = await res.json();
    if (page === 0) sync = body.sync ?? null;
    payments.push(...(body.payments ?? []));
    options.onProgress?.(payments.length);

    cursor = body.next_cursor ?? null;
    if (!cursor) return { payments, sync, truncated: false };
  }

  return { payments, sync, truncated: true };
}
