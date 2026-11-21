/**
 * Verifies that OfflineSyncEngine works in a host with no localStorage and no
 * window (e.g. Node, React Native, bridgeless workers). The existing
 * offline-sync.dom.test.ts covers the jsdom / localStorage path; this file
 * covers the in-memory fallback.
 *
 * This test must run in the default Node environment (no @vitest-environment
 * jsdom docblock) so that globalThis.localStorage is genuinely absent.
 */
import { describe, it, expect } from 'vitest';
import { OfflineSyncEngine } from './offline-sync';

describe('OfflineSyncEngine – no-storage environment', () => {
  it('init resolves without throwing when localStorage and window are absent', async () => {
    const engine = new OfflineSyncEngine({ storageKey: 'nostorage-test', syncIntervalMs: 0 });
    await expect(engine.init()).resolves.toBeUndefined();
  });

  it('queueUpdate does not throw and getPendingCount returns 1', async () => {
    const engine = new OfflineSyncEngine({ storageKey: 'nostorage-test-2', syncIntervalMs: 0 });
    await engine.init();

    expect(() => engine.queueUpdate('orders', 'o1', { status: 'refunded' })).not.toThrow();
    expect(engine.getPendingCount()).toBe(1);
  });

  it('clear resets the pending count to 0', async () => {
    const engine = new OfflineSyncEngine({ storageKey: 'nostorage-test-3', syncIntervalMs: 0 });
    await engine.init();
    engine.queueUpdate('orders', 'o2', { status: 'ready' });
    expect(engine.getPendingCount()).toBe(1);

    engine.clear();
    expect(engine.getPendingCount()).toBe(0);
  });

  it('two init calls on the same instance preserve queued ops', async () => {
    const engine = new OfflineSyncEngine({ storageKey: 'nostorage-test-4', syncIntervalMs: 0 });
    await engine.init();
    engine.queueUpdate('orders', 'o3', { status: 'pending' });

    // Second init reads from the in-memory store written by persist()
    await engine.init();
    expect(engine.getPendingCount()).toBe(1);
  });
});
