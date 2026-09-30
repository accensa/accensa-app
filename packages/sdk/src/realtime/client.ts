/**
 * Live payment subscription over WebSocket (#451).
 *
 * `subscribeToPayments` wraps {@link ReconnectingSocket}: it deserializes each
 * frame into an {@link Order}, routes failures to `onError`, and returns an
 * unsubscribe function that disposes of the socket and every timer.
 */

import { AccensaContractError, AccensaNetworkError } from '../errors';
import { orderFromWire } from '../mapping';
import type { Order } from '../types/order';
import { ReconnectingSocket, type ReconnectingSocketOptions, type SocketFactory } from './socket';

export interface SubscribeToPaymentsOptions {
  /** Merchant whose payments to stream. */
  merchantId: string;
  onPayment: (order: Order) => void;
  /** Receives malformed frames and connection drops. The socket keeps reconnecting. */
  onError?: (error: Error) => void;
  /** Fires when a connection (re)opens. */
  onConnect?: () => void;
  /** Base URL of the indexer; `http(s)` is mapped to `ws(s)`. */
  indexerUrl: string;
  /** Injected in tests. Defaults to the global `WebSocket`. */
  socketFactory?: SocketFactory;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  heartbeatIntervalMs?: number;
  pongTimeoutMs?: number;
}

/** Path served by the indexer for live payment events. */
export const PAYMENTS_STREAM_PATH = '/api/payments/stream';

export function paymentsStreamUrl(indexerUrl: string, merchantId: string): string {
  const base = indexerUrl.replace(/\/$/, '').replace(/^http/i, 'ws');
  return `${base}${PAYMENTS_STREAM_PATH}?merchantId=${encodeURIComponent(merchantId)}`;
}

/**
 * Subscribes to a merchant's live payments. Returns an unsubscribe function
 * that closes the socket for good; calling it twice is safe.
 */
export function subscribeToPayments(opts: SubscribeToPaymentsOptions): () => void {
  if (!opts.merchantId) {
    throw new AccensaContractError('subscribeToPayments requires a merchantId');
  }
  const { onPayment, onError } = opts;
  let active = true;

  const socketOpts: ReconnectingSocketOptions = {
    url: paymentsStreamUrl(opts.indexerUrl, opts.merchantId),
    socketFactory: opts.socketFactory,
    initialBackoffMs: opts.initialBackoffMs,
    maxBackoffMs: opts.maxBackoffMs,
    heartbeatIntervalMs: opts.heartbeatIntervalMs,
    pongTimeoutMs: opts.pongTimeoutMs,
    onOpen: () => opts.onConnect?.(),
    onDisconnect: (reason) =>
      onError?.(new AccensaNetworkError(`Payment stream disconnected (${reason}); reconnecting`)),
    onMessage: (data) => {
      let order: Order | null;
      let parseError: unknown;
      try {
        order = orderFromWire(JSON.parse(data));
      } catch (cause) {
        order = null;
        parseError = cause;
      }
      if (!order) {
        onError?.(
          new AccensaContractError('Payment stream sent a malformed frame', { cause: parseError }),
        );
        return;
      }
      try {
        onPayment(order);
      } catch (cause) {
        // A throwing consumer must not tear down the subscription.
        onError?.(cause instanceof Error ? cause : new Error(String(cause)));
      }
    },
  };

  const socket = new ReconnectingSocket(socketOpts);
  socket.connect();

  return () => {
    if (!active) return;
    active = false;
    socket.close();
  };
}
