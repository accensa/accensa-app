/**
 * Resilient WebSocket wrapper: automatic reconnection with exponential
 * backoff, and a ping/pong watchdog that detects zombie connections (#451).
 *
 * The wrapper owns only transport concerns. Message deserialization and
 * error routing are delegated to the caller through {@link ReconnectingSocketOptions}.
 */

/** The subset of the WebSocket API this wrapper needs; satisfied by the browser and `ws`. */
export interface SocketLike {
  readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string) => SocketLike;

/** Wire-level heartbeat frames. The server answers a `ping` with a `pong`. */
export const PING_FRAME = JSON.stringify({ type: 'ping' });

export interface ReconnectingSocketOptions {
  url: string;
  /** Injected in tests. Defaults to the global `WebSocket`. */
  socketFactory?: SocketFactory;
  /** First reconnect delay in ms; doubles each attempt. Default 500. */
  initialBackoffMs?: number;
  /** Ceiling for the reconnect delay in ms. Default 30 000. */
  maxBackoffMs?: number;
  /** How often to ping an open connection in ms. Default 15 000. */
  heartbeatIntervalMs?: number;
  /** How long to wait for a pong before declaring the socket dead in ms. Default 5 000. */
  pongTimeoutMs?: number;
  /** Called with every raw frame except `pong`s. */
  onMessage: (data: string) => void;
  onOpen?: () => void;
  /** Called when a connection drops, before the reconnect is scheduled. */
  onDisconnect?: (reason: 'close' | 'error' | 'heartbeat-timeout') => void;
  /** Random source for backoff jitter; injected in tests. Defaults to `Math.random`. */
  random?: () => number;
}

const WS_OPEN = 1;

/**
 * Delay before reconnect attempt `attempt` (0-based): `initial * 2^attempt`,
 * capped at `max`, with up to 20% jitter so a fleet of clients that lost the
 * same server does not reconnect in lockstep.
 */
export function backoffDelay(
  attempt: number,
  initialMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const exp = Math.min(maxMs, initialMs * 2 ** Math.min(attempt, 30));
  return Math.min(maxMs, Math.round(exp * (1 + 0.2 * random())));
}

export class ReconnectingSocket {
  private socket: SocketLike | null = null;
  private attempt = 0;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: ReconnectingSocketOptions) {}

  /** Opens the connection. Reconnects on its own until {@link close} is called. */
  connect(): void {
    if (this.closed || this.socket) return;
    const factory =
      this.opts.socketFactory ??
      ((url: string) =>
        new (globalThis as { WebSocket: new (u: string) => SocketLike }).WebSocket(url));
    const socket = factory(this.opts.url);
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.startHeartbeat(socket);
      this.opts.onOpen?.();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      const data = typeof event.data === 'string' ? event.data : String(event.data);
      // Any inbound frame proves the link is alive, so it also satisfies the watchdog.
      this.clearPongTimer();
      if (isPong(data)) return;
      this.opts.onMessage(data);
    };
    socket.onerror = () => this.handleDrop(socket, 'error');
    socket.onclose = () => this.handleDrop(socket, 'close');
  }

  /** Permanently closes the connection and cancels every timer. Idempotent. */
  close(): void {
    this.closed = true;
    this.stopTimers();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      try {
        socket.close(1000, 'client closed');
      } catch {
        // Already closed; nothing to release.
      }
    }
  }

  private startHeartbeat(socket: SocketLike): void {
    const { heartbeatIntervalMs = 15_000, pongTimeoutMs = 5_000 } = this.opts;
    this.stopTimers();
    this.pingTimer = setInterval(() => {
      if (socket.readyState !== WS_OPEN) return;
      try {
        socket.send(PING_FRAME);
      } catch {
        this.handleDrop(socket, 'error');
        return;
      }
      this.clearPongTimer();
      this.pongTimer = setTimeout(
        () => this.handleDrop(socket, 'heartbeat-timeout'),
        pongTimeoutMs,
      );
    }, heartbeatIntervalMs);
  }

  private handleDrop(socket: SocketLike, reason: 'close' | 'error' | 'heartbeat-timeout'): void {
    // A stale socket (already replaced or closed by us) must not trigger a second reconnect.
    if (this.closed || this.socket !== socket) return;
    this.stopTimers();
    this.socket = null;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try {
      socket.close();
    } catch {
      // Zombie sockets may throw on close; the reconnect below replaces it anyway.
    }
    this.opts.onDisconnect?.(reason);

    const { initialBackoffMs = 500, maxBackoffMs = 30_000, random } = this.opts;
    const delay = backoffDelay(this.attempt++, initialBackoffMs, maxBackoffMs, random);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearPongTimer(): void {
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = null;
  }

  private stopTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.clearPongTimer();
  }
}

function isPong(data: string): boolean {
  if (!data.includes('pong')) return false;
  try {
    return (JSON.parse(data) as { type?: unknown }).type === 'pong';
  } catch {
    return false;
  }
}
