/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { OfflineSyncEngine } from './offline-sync';

describe('OfflineSyncEngine in a browser DOM', () => {
  afterEach(() => {
    localStorage.clear();
    window.dispatchEvent(new Event('online'));
  });

  it('persists queued work offline and flushes it when connectivity returns', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const engine = new OfflineSyncEngine({ storageKey: 'offline-dom-test', syncIntervalMs: 0 });
    await engine.init();

    window.dispatchEvent(new Event('offline'));
    engine.queueUpdate('orders', 'order-1', { status: 'ready' });

    expect(engine.getPendingCount()).toBe(1);
    expect(JSON.parse(localStorage.getItem('offline-dom-test')!).pendingOps).toHaveLength(1);

    window.dispatchEvent(new Event('online'));
    await Promise.resolve();

    expect(engine.getPendingCount()).toBe(0);
    expect(JSON.parse(localStorage.getItem('offline-dom-test')!).pendingOps).toHaveLength(0);
  });
});
