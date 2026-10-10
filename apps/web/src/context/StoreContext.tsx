'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export interface MerchantStore {
  id: number;
  merchantId: number;
  address: string;
  name: string;
  createdAt: string;
}

interface StoreContextValue {
  stores: MerchantStore[];
  activeStoreId: number | null;
  loading: boolean;
  error: string | null;
  refreshStores: () => Promise<void>;
  selectStore: (storeId: number | null) => Promise<void>;
}

const ACTIVE_STORE_KEY = 'accensa:active-store';
const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [stores, setStores] = useState<MerchantStore[]>([]);
  const [activeStoreId, setActiveStoreId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStores = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/merchant/stores', { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load stores');
      const result = (await response.json()) as {
        stores: MerchantStore[];
        activeStoreId: number | null;
      };
      setStores(result.stores);
      setActiveStoreId(result.activeStoreId);
      setError(null);
      try {
        localStorage.setItem(ACTIVE_STORE_KEY, result.activeStoreId?.toString() ?? 'organization');
      } catch {
        // The signed, HTTP-only server cookie remains authoritative.
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load stores');
    } finally {
      setLoading(false);
    }
  }, []);

  const selectStore = useCallback(async (storeId: number | null) => {
    const response = await fetch('/api/merchant/stores/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId }),
    });
    if (!response.ok) throw new Error('Unable to switch store');
    try {
      localStorage.setItem(ACTIVE_STORE_KEY, storeId?.toString() ?? 'organization');
    } catch {
      // The signed, HTTP-only server cookie remains authoritative.
    }
    window.location.reload();
  }, []);

  return (
    <StoreContext.Provider
      value={{ stores, activeStoreId, loading, error, refreshStores, selectStore }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStoreContext(): StoreContextValue {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStoreContext must be used within StoreProvider');
  return context;
}
