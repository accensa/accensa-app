'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

interface TelemetryData {
  tx_hash: string;
  amount: string;
  asset: string | null;
  payer: string;
  ts: string;
  route: string | null;
}

interface TelemetryState {
  isConnected: boolean;
  lastUpdate: Date | null;
  recentPayments: TelemetryData[];
}

export function useMerchantTelemetry(merchantId: string | null) {
  const [state, setState] = useState<TelemetryState>({
    isConnected: false,
    lastUpdate: null,
    recentPayments: [],
  });
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_DELAY = 3000;

  const connect = useCallback(() => {
    if (!merchantId || eventSourceRef.current) return;

    const eventSource = new EventSource(`/api/telemetry?merchant=${merchantId}`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setState((prev) => ({ ...prev, isConnected: true }));
      reconnectAttempts.current = 0;
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as TelemetryData;
        setState((prev) => ({
          ...prev,
          lastUpdate: new Date(),
          recentPayments: [data, ...prev.recentPayments].slice(0, 10),
        }));
      } catch (error) {
        console.error('Failed to parse telemetry data:', error);
      }
    };

    eventSource.onerror = () => {
      setState((prev) => ({ ...prev, isConnected: false }));
      eventSource.close();
      eventSourceRef.current = null;

      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts.current += 1;
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, RECONNECT_DELAY);
      }
    };
  }, [merchantId]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectAttempts.current = 0;
    setState((prev) => ({ ...prev, isConnected: false }));
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return state;
}
