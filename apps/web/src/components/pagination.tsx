'use client';

/**
 * Server-side pagination controls for the transaction history table.
 *
 * Renders Previous/Next buttons plus a window of page numbers around the
 * current page. Next is disabled on the last page and Previous on the first,
 * so the merchant always knows where the list ends without a request.
 *
 * The page-window logic is exported separately ({@link pageWindow}) so it can
 * be unit tested without a DOM.
 */

export type PageWindowEntry = number | '…';

/**
 * The page numbers to render, with ellipses for the gap.
 *
 * Shows every page when there are seven or fewer; otherwise a window of the
 * current page's neighbours pinned to the first and last pages:
 *
 * - total 20, current 1  -> [1, 2, …, 20]
 * - total 20, current 10 -> [1, …, 9, 10, 11, …, 20]
 */
export function pageWindow(current: number, total: number): PageWindowEntry[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const wanted = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...wanted].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

  const entries: PageWindowEntry[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (page - previous > 1) entries.push('…');
    entries.push(page);
    previous = page;
  }
  return entries;
}

export interface PaginationProps {
  /** The page currently shown (1-based). */
  page: number;
  /** Total number of pages; 0 means there is nothing to page over. */
  totalPages: number;
  /** Called with the requested page when a control is activated. */
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  const canGoBack = page > 1;
  const canGoForward = page < totalPages;

  const controlClass = (enabled: boolean) =>
    `px-3 py-2 text-[10px] font-bold uppercase tracking-widest border transition-colors cursor-pointer disabled:cursor-not-allowed ${
      enabled
        ? 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5'
        : 'border-slate-100 dark:border-white/5 text-slate-300 dark:text-slate-600 opacity-60'
    }`;

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={!canGoBack}
        className={controlClass(canGoBack)}
      >
        Previous
      </button>

      <div className="flex items-center gap-1.5">
        {pageWindow(page, totalPages).map((entry, index) =>
          entry === '…' ? (
            <span
              key={`ellipsis-${index}`}
              aria-hidden="true"
              className="px-1 text-slate-400 dark:text-slate-500"
            >
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              onClick={() => onPageChange(entry)}
              aria-current={entry === page ? 'page' : undefined}
              aria-label={`Page ${entry}`}
              className={`min-w-9 px-2 py-2 text-xs font-bold tabular-nums transition-colors cursor-pointer ${
                entry === page
                  ? 'bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5'
              }`}
            >
              {entry}
            </button>
          ),
        )}
      </div>

      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={!canGoForward}
        className={controlClass(canGoForward)}
      >
        Next
      </button>
    </nav>
  );
}
