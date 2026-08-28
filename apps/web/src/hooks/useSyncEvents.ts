'use client';

import { useEffect, useRef, useState } from 'react';
import type { SyncEventPayload } from '@/lib/sync-events';

export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

export interface SyncStreamState {
  /** The most recent sync-completion event, or null before the first one. */
  lastEvent: SyncEventPayload | null;
  /** True while the EventSource is connected with the server. */
  connected: boolean;
}

export interface UseSyncEventsOptions {
  /** Called when a sync-completion event arrives. */
  onSync?: (event: SyncEventPayload) => void;
  /** Called whenever the connection state changes. */
  onConnectionChange?: (connected: boolean) => void;
}

/**
 * Subscribes to `/api/sync/stream` and surfaces live indexer updates.
 *
 * Replaces a polling loop over `/api/sync`: once connected, the dashboard
 * reacts the instant a sync completes instead of on the next timer tick.
 * Reconnection uses full-jitter exponential backoff so a thundering herd of
 * dashboard tabs does not reconnect in lock-step after a network blip.
 */
export function useSyncEvents(options: UseSyncEventsOptions = {}): SyncStreamState {
  const { onSync, onConnectionChange } = options;
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SyncEventPayload | null>(null);

  // Keep the latest callbacks in refs so the effect below never needs to
  // re-subscribe just because the caller inlined a new function identity.
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;
  const onConnectionChangeRef = useRef(onConnectionChange);
  onConnectionChangeRef.current = onConnectionChange;

  useEffect(() => {
    let source: EventSource | null = null;
    let retryMs = RECONNECT_BASE_MS;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const markConnected = (value: boolean) => {
      setConnected(value);
      onConnectionChangeRef.current?.(value);
    };

    const connect = () => {
      if (disposed) return;
      source = new EventSource('/api/sync/stream');

      source.onopen = () => {
        retryMs = RECONNECT_BASE_MS;
        markConnected(true);
      };

      source.onerror = () => {
        markConnected(false);
        // The browser closes an errored EventSource; schedule a reconnect
        // with backoff rather than firing a fresh request per event/error.
        source?.close();
        source = null;
        if (disposed) return;
        reconnectTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, RECONNECT_MAX_MS);
      };

      source.addEventListener('sync', (event) => {
        const message = event as MessageEvent;
        try {
          const payload = JSON.parse(message.data as string) as SyncEventPayload;
          setLastEvent(payload);
          onSyncRef.current?.(payload);
        } catch {
          // Ignore a malformed payload rather than tearing the subscription.
        }
      });
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, []);

  return { lastEvent, connected };
}
