import type { NextRequest } from 'next/server';

/**
 * In-process Server-Sent Events relay for indexer synchronisation.
 *
 * The dashboard previously polled `/api/sync` on a timer to learn when new
 * payments had been indexed. That couples polling frequency to latency and
 * burns RPC/DB work on requests that find nothing new. This module decouples
 * the two: the sync route notifies connected subscribers the moment a run
 * finishes, and the dashboard subscribes once and updates on arrival.
 *
 * State is held in a module-level registry keyed by merchant. On a single
 * instance this is exactly what we want. In a horizontally scaled deployment
 * the same shape can be backed by Redis Pub/Sub (publish to a `sync:*` channel
 * and have each node echo it to its local subscribers) without changing the
 * consumer contract below.
 */

interface SyncSubscriber {
  merchantId: number;
  controller: ReadableStreamDefaultController<Uint8Array>;
}

/** Clients registered by merchant id. Use a Map so subscription is O(1). */
const subscribers = new Map<number, Set<SyncSubscriber>>();

const HEARTBEAT_MS = 25_000;

/** The payload shape pushed to clients whenever a sync run completes. */
export interface SyncEventPayload {
  merchant: string;
  syncedTo: number;
  inserted: number;
  scanned: number;
  pages: number;
  drained: boolean;
  occurredAt: string;
}

function encode(eventName: string, payload: unknown): Uint8Array {
  const text = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  return new TextEncoder().encode(text);
}

function remove(subscriber: SyncSubscriber): void {
  const set = subscribers.get(subscriber.merchantId);
  if (!set) return;
  set.delete(subscriber);
  if (set.size === 0) subscribers.delete(subscriber.merchantId);
}

/** Pushes a completion event to every client subscribed to `merchantId`. */
export function broadcastSyncEvent(merchantId: number, payload: SyncEventPayload): void {
  const set = subscribers.get(merchantId);
  if (!set || set.size === 0) return;
  const bytes = encode('sync', payload);
  for (const subscriber of [...set]) {
    try {
      subscriber.controller.enqueue(bytes);
    } catch {
      // Client went away mid-write; drop it rather than crash the run.
      remove(subscriber);
    }
  }
}

/** Called on a timer to keep otherwise-idle connections alive. */
function sendHeartbeats(): void {
  const bytes = encode('heartbeat', { at: new Date().toISOString() });
  for (const set of subscribers.values()) {
    for (const subscriber of [...set]) {
      try {
        subscriber.controller.enqueue(bytes);
      } catch {
        remove(subscriber);
      }
    }
  }
}

/** True when any client is listening; used to short-circuit broadcast work. */
export function hasSubscribers(merchantId: number): boolean {
  return (subscribers.get(merchantId)?.size ?? 0) > 0;
}

/** Registers a subscriber and returns a cleanup function to release it. */
export function registerSubscriber(
  merchantId: number,
  controller: ReadableStreamDefaultController<Uint8Array>,
): () => void {
  let set = subscribers.get(merchantId);
  if (!set) {
    set = new Set();
    subscribers.set(merchantId, set);
  }
  const subscriber: SyncSubscriber = { merchantId, controller };
  set.add(subscriber);

  return () => {
    set.delete(subscriber);
    if (set.size === 0) subscribers.delete(merchantId);
    try {
      controller.close();
    } catch {
      // Already closed.
    }
  };
}

/**
 * Builds the Response backing a single SSE subscription.
 *
 * The request's `AbortSignal` releases the subscriber as soon as the tab drops
 * the connection, so dead clients never pile up. A heartbeat interval keeps
 * intermediaries and the client from timing the idle connection out.
 */
export function createSyncStream(request: NextRequest, merchantId: number): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const unregister = registerSubscriber(merchantId, controller);
      const heartbeat = setInterval(sendHeartbeats, HEARTBEAT_MS);

      const onAbort = () => {
        unregister();
        clearInterval(heartbeat);
        request.signal.removeEventListener('abort', onAbort);
      };
      request.signal.addEventListener('abort', onAbort);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
