'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useStoreContext } from '@/context/StoreContext';

export function StoreSwitcher() {
  const { stores, activeStoreId, loading, error, refreshStores, selectStore } = useStoreContext();

  useEffect(() => {
    void refreshStores();
  }, [refreshStores]);

  if (error) return null;
  if (loading && stores.length === 0) {
    return (
      <div aria-hidden="true" className="h-9 w-36 animate-pulse bg-slate-200 dark:bg-white/10" />
    );
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="active-store" className="sr-only">
        Active store
      </label>
      <select
        id="active-store"
        aria-label="Active store"
        value={activeStoreId?.toString() ?? 'organization'}
        disabled={loading}
        onChange={(event) => {
          const value = event.currentTarget.value;
          void selectStore(value === 'organization' ? null : Number(value));
        }}
        className="h-9 max-w-44 border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800 dark:border-white/20 dark:bg-slate-900 dark:text-slate-100"
      >
        <option value="organization">Organization</option>
        {stores.map((store) => (
          <option key={store.id} value={store.id}>
            {store.name}
          </option>
        ))}
      </select>
      <Link
        href="/merchant/stores"
        aria-label="Manage stores"
        title="Manage stores"
        className="inline-flex h-9 items-center border border-slate-300 px-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-white/20 dark:text-slate-200 dark:hover:bg-white/10"
      >
        Stores
      </Link>
    </div>
  );
}
