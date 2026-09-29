import type { NextRequest } from 'next/server';
import type { DisputeChatMessage } from './dispute-chat-store';

/**
 * In-process Server-Sent Events relay for the dispute negotiation chat
 * (#429), mirroring `sync-events.ts`'s shape: one Map of subscribers keyed
 * by room (here a dispute id instead of a merchant id), correct on a single
 * instance and swappable for Redis Pub/Sub in a scaled deployment.
 */

interface DisputeChatSubscriber {
  disputeId: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
}

const subscribers = new Map<string, Set<DisputeChatSubscriber>>();

const HEARTBEAT_MS = 25_000;

function encode(eventName: string, payload: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function remove(subscriber: DisputeChatSubscriber): void {
  const set = subscribers.get(subscriber.disputeId);
  if (!set) return;
  set.delete(subscriber);
  if (set.size === 0) subscribers.delete(subscriber.disputeId);
}

/** Pushes a new message to every client subscribed to `disputeId`. */
export function broadcastDisputeChatMessage(disputeId: string, message: DisputeChatMessage): void {
  const set = subscribers.get(disputeId);
  if (!set || set.size === 0) return;
  const bytes = encode('message', message);
  for (const subscriber of [...set]) {
    try {
      subscriber.controller.enqueue(bytes);
    } catch {
      remove(subscriber);
    }
  }
}

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

function registerSubscriber(
  disputeId: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
): () => void {
  let set = subscribers.get(disputeId);
  if (!set) {
    set = new Set();
    subscribers.set(disputeId, set);
  }
  const subscriber: DisputeChatSubscriber = { disputeId, controller };
  set.add(subscriber);

  return () => {
    set!.delete(subscriber);
    if (set!.size === 0) subscribers.delete(disputeId);
    try {
      controller.close();
    } catch {
      // Already closed.
    }
  };
}

/** Builds the Response backing a single dispute chat SSE subscription. */
export function createDisputeChatStream(request: NextRequest, disputeId: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const unregister = registerSubscriber(disputeId, controller);
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
