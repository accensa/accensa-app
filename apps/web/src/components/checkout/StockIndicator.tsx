export interface StockIndicatorProps {
  available: number;
  lowStockThreshold: number;
}

export function StockIndicator({ available, lowStockThreshold }: StockIndicatorProps) {
  if (!Number.isFinite(available) || available < 0) return null;
  if (available === 0) {
    return (
      <span role="alert" className="text-xs font-semibold text-red-700 dark:text-red-300">
        Out of stock
      </span>
    );
  }
  if (available >= lowStockThreshold) return null;

  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center border border-amber-500/40 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    >
      Only {available} {available === 1 ? 'item' : 'items'} left
    </span>
  );
}
