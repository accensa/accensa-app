/**
 * Shared utilities for micro-frontend communication and coordination.
 */

export interface FedEvent<T = unknown> {
  type: string;
  payload: T;
  source: string;
  timestamp: number;
}

/**
 * Create a typed event for cross-remote communication.
 */
export function createEvent<T>(type: string, payload: T, source: string): FedEvent<T> {
  return { type, payload, source, timestamp: Date.now() };
}

/**
 * Format a currency amount for display across micro-frontends.
 */
export function formatAmount(amount: string | number, asset?: string | null): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (Number.isNaN(num)) return '0';
  const formatted = num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 7 });
  return asset ? `${formatted} ${asset}` : formatted;
}
