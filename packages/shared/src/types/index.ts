/**
 * Shared type definitions for micro-frontend boundaries.
 *
 * These types define the contracts between federated modules, ensuring
 * type safety across remote boundaries.
 */

export interface Merchant {
  id: string;
  name: string;
  createdAt: string;
}

export interface Payment {
  tx_hash: string;
  ledger: number | null;
  payer: string;
  amount: string;
  asset: string | null;
  ts: string;
  route: string | null;
  method: string | null;
}

export interface SyncState {
  lastSyncTs: string | null;
  status: 'idle' | 'syncing' | 'error';
}

export interface FilterParams {
  route?: string;
  payer?: string;
  asset?: string;
  date_from?: string;
  date_to?: string;
}
