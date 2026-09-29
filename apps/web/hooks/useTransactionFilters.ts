import { useRouter } from 'next/router';
import { useCallback, useMemo } from 'react';

export interface TransactionFilters {
  search: string;
  status: string;
  asset: string;
  dateRange: string;
}

function readQueryFilters(query: ReturnType<typeof useRouter>['query']): TransactionFilters {
  const read = (key: string) => {
    const value = query[key];
    return (typeof value === 'string' ? value : undefined) ?? '';
  };
  return {
    search: read('search'),
    status: read('status'),
    asset: read('asset'),
    dateRange: read('dateRange'),
  };
}

export function useTransactionFilters() {
  const router = useRouter();

  // The URL is the source of truth: filters are derived from the router query
  // instead of being mirrored into state through an effect, which both avoids
  // the cascading render the lint rule rejects and keeps back/forward
  // navigation in sync for free (the old effect only re-read the URL when the
  // query object changed identity, never on history restoration).
  const query = router.query;
  const filters = useMemo(() => readQueryFilters(query), [query]);

  const updateFilters = useCallback(
    (newFilters: Partial<TransactionFilters>) => {
      const merged = { ...filters, ...newFilters };

      const nextQuery = { ...router.query };
      Object.entries(merged).forEach(([key, value]) => {
        if (value) {
          nextQuery[key] = value;
        } else {
          delete nextQuery[key];
        }
      });

      router.push({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true });
    },
    [filters, router],
  );

  const clearFilters = useCallback(() => {
    // Pushing an empty query re-derives the empty filters on the next render.
    router.push({ pathname: router.pathname, query: {} }, undefined, { shallow: true });
  }, [router]);

  return { filters, updateFilters, clearFilters };
}
