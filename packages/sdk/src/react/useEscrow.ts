import { useState, useCallback } from 'react';
import { useAccensa } from './useAccensa';
import type { Order } from '../types/order';

export function useEscrow() {
  const client = useAccensa();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [escrowOrders, setEscrowOrders] = useState<Order[]>([]);

  const fetchEscrows = useCallback(
    async (limit: number = 50) => {
      setLoading(true);
      setError(null);
      try {
        // In a real implementation this would call a specific escrow endpoint.
        // We simulate by fetching orders that might have an escrow state.
        const page = await client.listOrders({ limit });
        setEscrowOrders(page.orders);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch escrows'));
      } finally {
        setLoading(false);
      }
    },
    [client],
  );

  return { escrowOrders, loading, error, fetchEscrows };
}
