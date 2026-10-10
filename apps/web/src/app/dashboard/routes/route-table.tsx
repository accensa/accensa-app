import React from 'react';
import { formatAmount, assetLabel } from '@/lib/money';
import { UNATTRIBUTED_LABEL, type RouteBucket } from '@/lib/revenue-analytics';

export function RouteTable({
  breakdown,
  asset,
}: {
  breakdown: NonNullable<ReturnType<typeof import('@/lib/revenue-analytics').buildRouteBreakdown>>;
  asset: string;
}) {
  const rows: RouteBucket[] = [
    ...breakdown.routes,
    ...(breakdown.unattributed ? [breakdown.unattributed] : []),
  ];

  if (rows.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Nothing to break down yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Revenue by route breakdown</caption>
        <thead>
          <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 text-left">
            <th scope="col" className="pb-3 pr-4">
              Route
            </th>
            <th scope="col" className="pb-3 pr-4 text-right">
              Calls
            </th>
            <th scope="col" className="pb-3 pr-4 text-right">
              Revenue
            </th>
            <th scope="col" className="pb-3 pr-4 text-right">
              Average
            </th>
            <th scope="col" className="pb-3 w-1/4">
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className="border-t border-slate-100 dark:border-white/5 transition-colors duration-300"
            >
              <td className="py-3 pr-4">
                {row.attributed ? (
                  <span className="font-mono text-slate-900 dark:text-white break-all">
                    <span className="text-emerald-600 dark:text-emerald-400 mr-2">
                      {row.method}
                    </span>
                    {row.route}
                  </span>
                ) : (
                  <span
                    className="text-slate-500 dark:text-slate-400 italic"
                    title="Chain-indexed transfers your server never reported a route for. Real revenue; unknown endpoint."
                  >
                    {UNATTRIBUTED_LABEL}
                  </span>
                )}
              </td>
              <td className="py-3 pr-4 text-right tabular-nums text-slate-600 dark:text-slate-300">
                {row.calls}
                {row.unpriced > 0 && (
                  <span
                    className="text-slate-400 dark:text-slate-500"
                    title={`${row.unpriced} had an unreadable amount and were not summed`}
                  >
                    {' '}
                    ({row.unpriced} unpriced)
                  </span>
                )}
              </td>
              <td className="py-3 pr-4 text-right tabular-nums text-slate-900 dark:text-white font-medium">
                {formatAmount(row.total)} {assetLabel(asset)}
              </td>
              <td className="py-3 pr-4 text-right tabular-nums text-slate-600 dark:text-slate-300">
                {row.average === null ? '—' : formatAmount(row.average)}
              </td>
              <td className="py-3">
                <span className="sr-only">{`${Math.round(row.share * 100)}%`}</span>
                <span
                  aria-hidden="true"
                  className="block h-2 bg-slate-100 dark:bg-white/5"
                  title={`${Math.round(row.share * 100)}% of settled revenue in this asset`}
                >
                  <span
                    className={`block h-2 ${
                      row.attributed
                        ? 'bg-emerald-500/80 dark:bg-emerald-400/70'
                        : 'bg-slate-300 dark:bg-white/20'
                    }`}
                    style={{ width: `${Math.max(row.share * 100, row.total === '0' ? 0 : 1)}%` }}
                  />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
