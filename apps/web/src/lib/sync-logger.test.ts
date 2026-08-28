import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logSyncFailure, notifySyncFailure } from './sync-logger';

describe('logSyncFailure', () => {
  it('logs one structured JSON line with merchant, ledger window, and the error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const error = new Error('RPC getEvents: [-32001] request exceeded processing limit');
    logSyncFailure({ merchant: 'GABC...MERCHANT', startLedger: 100, endLedger: 10_099 }, error);

    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);

    expect(logged.level).toBe('error');
    expect(logged.event).toBe('sync_failure');
    expect(logged.merchant).toBe('GABC...MERCHANT');
    expect(logged.startLedger).toBe(100);
    expect(logged.endLedger).toBe(10_099);
    expect(logged.error.name).toBe('Error');
    expect(logged.error.message).toContain('request exceeded processing limit');
    expect(typeof logged.error.stack).toBe('string');
    expect(typeof logged.ts).toBe('string');
    expect(() => new Date(logged.ts).toISOString()).not.toThrow();

    spy.mockRestore();
  });

  it('omits ledger fields entirely when the failure happened before any window was known', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logSyncFailure({ merchant: 'GABC...MERCHANT' }, new Error('DB connection refused'));

    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect('startLedger' in logged).toBe(false);
    expect('endLedger' in logged).toBe(false);

    spy.mockRestore();
  });

  it('recursively serializes a wrapped cause, keeping its own stack', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const rpcError = new Error('socket hang up');
    const wrapped = new Error('Failed to fetch events for ledger window [1, 2]', {
      cause: rpcError,
    });
    logSyncFailure({ merchant: 'GABC...MERCHANT' }, wrapped);

    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.error.message).toContain('Failed to fetch events');
    expect(logged.error.cause.message).toBe('socket hang up');
    expect(typeof logged.error.cause.stack).toBe('string');

    spy.mockRestore();
  });

  it('logs a non-Error throw without crashing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logSyncFailure({ merchant: 'GABC...MERCHANT' }, 'a plain string was thrown');

    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.error.name).toBe('NonErrorThrown');
    expect(logged.error.message).toBe('a plain string was thrown');

    spy.mockRestore();
  });
});

describe('notifySyncFailure', () => {
  const ORIGINAL_ENV = process.env.SYNC_ALERT_WEBHOOK_URL;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.SYNC_ALERT_WEBHOOK_URL;
    else process.env.SYNC_ALERT_WEBHOOK_URL = ORIGINAL_ENV;
  });

  it('does nothing when SYNC_ALERT_WEBHOOK_URL is not set', async () => {
    delete process.env.SYNC_ALERT_WEBHOOK_URL;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await notifySyncFailure({ merchant: 'GABC' }, new Error('boom'));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts a body with both content (Discord) and text (Slack) fields', async () => {
    process.env.SYNC_ALERT_WEBHOOK_URL = 'https://discord.example/webhook';
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    await notifySyncFailure(
      { merchant: 'GABC...MERCHANT', startLedger: 100, endLedger: 10_099 },
      new Error('RPC unreachable'),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://discord.example/webhook');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.content).toContain('GABC...MERCHANT');
    expect(body.content).toContain('100-10099');
    expect(body.content).toContain('RPC unreachable');
    expect(body.text).toBe(body.content);

    fetchSpy.mockRestore();
  });

  it('never throws when the webhook itself is unreachable', async () => {
    process.env.SYNC_ALERT_WEBHOOK_URL = 'https://discord.example/webhook';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(
      notifySyncFailure({ merchant: 'GABC' }, new Error('boom')),
    ).resolves.toBeUndefined();
  });
});
