import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccensaClient } from '../src/client';
import { AccensaContractError, AccensaNetworkError } from '../src/errors';
import { paymentsStreamUrl, subscribeToPayments } from '../src/realtime/client';
import { PING_FRAME, backoffDelay, type SocketLike } from '../src/realtime/socket';

class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  sent: string[] = [];
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  // Test helpers simulating the server side.
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

const factory = (url: string) => new FakeSocket(url);
const last = () => FakeSocket.instances[FakeSocket.instances.length - 1];
const wireOrder = { tx_hash: 'abc', amount: '1.5', ts: '2026-01-01T00:00:00Z', route: '/api/x' };

const base = {
  merchantId: 'GMERCHANT',
  indexerUrl: 'https://accensa.test',
  socketFactory: factory,
  initialBackoffMs: 100,
  maxBackoffMs: 1_000,
  heartbeatIntervalMs: 1_000,
  pongTimeoutMs: 200,
};

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('backoffDelay', () => {
  it('doubles per attempt and caps at the maximum', () => {
    const d = (n: number) => backoffDelay(n, 100, 1_000, () => 0);
    expect([d(0), d(1), d(2), d(3), d(4), d(50)]).toEqual([100, 200, 400, 800, 1_000, 1_000]);
  });

  it('adds at most 20% jitter without exceeding the cap', () => {
    expect(backoffDelay(0, 100, 1_000, () => 1)).toBe(120);
    expect(backoffDelay(10, 100, 1_000, () => 1)).toBe(1_000);
  });
});

describe('subscribeToPayments', () => {
  it('connects to the ws(s) stream URL and delivers deserialized payments', () => {
    const onPayment = vi.fn();
    subscribeToPayments({ ...base, onPayment });
    expect(last().url).toBe('wss://accensa.test/api/payments/stream?merchantId=GMERCHANT');
    last().open();
    last().receive(wireOrder);
    expect(onPayment).toHaveBeenCalledWith(expect.objectContaining({ id: 'abc', amount: '1.5' }));
  });

  it('maps http to ws and encodes the merchant id', () => {
    expect(paymentsStreamUrl('http://localhost:3000/', 'a b')).toBe(
      'ws://localhost:3000/api/payments/stream?merchantId=a%20b',
    );
  });

  it('rejects an empty merchantId', () => {
    expect(() => subscribeToPayments({ ...base, merchantId: '', onPayment: vi.fn() })).toThrow(
      AccensaContractError,
    );
  });

  it('routes malformed frames to onError and keeps the subscription', () => {
    const onPayment = vi.fn();
    const onError = vi.fn();
    subscribeToPayments({ ...base, onPayment, onError });
    last().open();
    last().receive('not json');
    last().receive({ tx_hash: 'missing-fields' });
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(AccensaContractError);
    last().receive(wireOrder);
    expect(onPayment).toHaveBeenCalledTimes(1);
  });

  it('survives a throwing onPayment handler', () => {
    const onError = vi.fn();
    subscribeToPayments({
      ...base,
      onPayment: () => {
        throw new Error('boom');
      },
      onError,
    });
    last().open();
    last().receive(wireOrder);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
  });

  it('reconnects with exponential backoff after server disconnects, resetting on success', () => {
    const onError = vi.fn();
    const onConnect = vi.fn();
    subscribeToPayments({ ...base, onPayment: vi.fn(), onError, onConnect });
    last().open();
    expect(onConnect).toHaveBeenCalledTimes(1);

    last().drop();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(AccensaNetworkError);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(99);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1); // 100ms: first retry
    expect(FakeSocket.instances).toHaveLength(2);

    last().drop(); // never opened: second retry waits 200ms
    vi.advanceTimersByTime(199);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(3);

    last().open(); // success resets the backoff
    last().drop();
    vi.advanceTimersByTime(100);
    expect(FakeSocket.instances).toHaveLength(4);
    expect(onConnect).toHaveBeenCalledTimes(2);
  });

  it('pings on an interval and stays connected while pongs arrive', () => {
    subscribeToPayments({ ...base, onPayment: vi.fn() });
    last().open();
    const socket = last();
    for (let i = 1; i <= 5; i++) {
      vi.advanceTimersByTime(1_000);
      expect(socket.sent).toHaveLength(i);
      socket.receive({ type: 'pong' });
    }
    expect(socket.sent.every((frame) => frame === PING_FRAME)).toBe(true);
    vi.advanceTimersByTime(100);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(socket.closed).toBe(false);
  });

  it('does not deliver pongs as payments', () => {
    const onPayment = vi.fn();
    const onError = vi.fn();
    subscribeToPayments({ ...base, onPayment, onError });
    last().open();
    last().receive({ type: 'pong' });
    expect(onPayment).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('tears down a zombie socket that misses the pong and reconnects', () => {
    const onError = vi.fn();
    subscribeToPayments({ ...base, onPayment: vi.fn(), onError });
    const zombie = last();
    zombie.open();
    vi.advanceTimersByTime(1_000); // ping goes out, no pong
    vi.advanceTimersByTime(200); // watchdog fires
    expect(zombie.closed).toBe(true);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('heartbeat-timeout') }),
    );
    vi.advanceTimersByTime(100);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('unsubscribe closes the socket, cancels timers, and is idempotent', () => {
    const unsubscribe = subscribeToPayments({ ...base, onPayment: vi.fn() });
    const socket = last();
    socket.open();
    unsubscribe();
    unsubscribe();
    expect(socket.closed).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(socket.sent).toEqual([]);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('unsubscribing while a reconnect is pending prevents the reconnect', () => {
    const unsubscribe = subscribeToPayments({ ...base, onPayment: vi.fn() });
    last().open();
    last().drop();
    unsubscribe();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('ignores a late close event from a socket that was already replaced', () => {
    subscribeToPayments({ ...base, onPayment: vi.fn() });
    const first = last();
    first.open();
    first.drop();
    vi.advanceTimersByTime(100);
    first.onclose?.({}); // handlers were detached, so this must be a no-op
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });
});

describe('AccensaClient.subscribeToPayments', () => {
  it('uses the client indexerUrl', () => {
    const client = new AccensaClient({ indexerUrl: 'https://idx.test/' });
    const unsubscribe = client.subscribeToPayments({
      merchantId: 'M1',
      onPayment: vi.fn(),
      socketFactory: factory,
    });
    expect(last().url).toBe('wss://idx.test/api/payments/stream?merchantId=M1');
    unsubscribe();
  });
});
