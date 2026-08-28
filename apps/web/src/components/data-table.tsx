import React from 'react';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  className?: string;
  render: (row: T) => React.ReactNode;
}

/**
 * The dashboard payments table, extracted far enough to document in Storybook
 * without dragging in fetch, auth, or refunds.
 *
 * Empty and loading states are first-class: those are the views a merchant
 * actually stares at, and they were previously only reachable through the
 * full page.
 */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  empty,
  loading,
  onRowClick,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  empty?: React.ReactNode;
  loading?: boolean;
  onRowClick?: (row: T) => void;
}) {
  if (loading) {
    return (
      <div data-testid="data-table-loading" className="p-8 space-y-3">
        <div className="h-4 w-1/3 bg-slate-100 dark:bg-white/5 animate-pulse" />
        <div className="h-4 w-2/3 bg-slate-100 dark:bg-white/5 animate-pulse" />
        <div className="h-4 w-1/2 bg-slate-100 dark:bg-white/5 animate-pulse" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        data-testid="data-table-empty"
        className="flex flex-col items-center justify-center h-[280px] text-center px-6 text-slate-500 dark:text-slate-400 text-sm"
      >
        {empty ?? 'No rows'}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto" data-testid="data-table">
      <table className="w-full text-left border-collapse whitespace-nowrap">
        <thead>
          <tr className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase tracking-widest border-b border-slate-100 dark:border-white/5">
            {columns.map((col) => (
              <th key={col.key} className={`px-8 py-5 ${col.className ?? ''}`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={
                onRowClick
                  ? 'hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors cursor-pointer'
                  : undefined
              }
            >
              {columns.map((col) => (
                <td key={col.key} className={`px-8 py-5 ${col.className ?? ''}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
