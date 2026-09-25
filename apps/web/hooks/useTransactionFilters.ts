import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';

export interface TransactionFilters {
  search: string;
  status: string;
  asset: string;
  dateRange: string;
}

export function useTransactionFilters() {
  const router = useRouter();
  const [filters, setFilters] = useState<TransactionFilters>({
    search: (router.query.search as string) || '',
    status: (router.query.status as string) || '',
    asset: (router.query.asset as string) || '',
    dateRange: (router.query.dateRange as string) || '',
  });

  useEffect(() => {
    if (router.isReady) {
      setFilters({
        search: (router.query.search as string) || '',
        status: (router.query.status as string) || '',
        asset: (router.query.asset as string) || '',
        dateRange: (router.query.dateRange as string) || '',
      });
    }
  }, [router.isReady, router.query]);

  const updateFilters = useCallback(
    (newFilters: Partial<TransactionFilters>) => {
      const merged = { ...filters, ...newFilters };
      setFilters(merged);

      const query = { ...router.query };
      
      Object.entries(merged).forEach(([key, value]) => {
        if (value) {
          query[key] = value;
        } else {
          delete query[key];
        }
      });

      router.push({ pathname: router.pathname, query }, undefined, { shallow: true });
    },
    [filters, router]
  );

  const clearFilters = useCallback(() => {
    setFilters({ search: '', status: '', asset: '', dateRange: '' });
    router.push({ pathname: router.pathname }, undefined, { shallow: true });
  }, [router]);

  return { filters, updateFilters, clearFilters };
}
