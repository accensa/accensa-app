import { createContext, useContext, useMemo, ReactNode } from 'react';
import { AccensaClient, AccensaClientOptions } from '../client';

export const AccensaContext = createContext<AccensaClient | null>(null);

export interface AccensaProviderProps {
  options: AccensaClientOptions;
  children: ReactNode;
}

export function AccensaProvider({ options, children }: AccensaProviderProps) {
  const client = useMemo(
    () => new AccensaClient(options),
    [options.indexerUrl, options.headers, options.timeoutMs, options.cacheTtlMs],
  );

  return <AccensaContext.Provider value={client}>{children}</AccensaContext.Provider>;
}

export function useAccensa(): AccensaClient {
  const context = useContext(AccensaContext);
  if (!context) {
    throw new Error('useAccensa must be used within an AccensaProvider');
  }
  return context;
}
