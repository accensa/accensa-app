/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccensaClient } from './client';
import type { SyncEvent } from './types/sync-event';

class MockEventSource extends EventTarget {
  static instances: MockEventSource[] = [];
  readonly close = vi.fn();

  constructor(readonly url: string) {
    super();
    MockEventSource.instances.push(this);
  }
}

describe('AccensaClient sync event stream', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MockEventSource.instances = [];
  });

  it('delivers sync events and closes the stream when unsubscribed', () => {
    vi.stubGlobal('EventSource', MockEventSource);
    const client = new AccensaClient({ indexerUrl: 'https://indexer.example' });
    const onSync = vi.fn();
    const unsubscribe = client.subscribeSync({ onSync });
    const source = MockEventSource.instances[0];
    const payload: SyncEvent = {
      merchant: 'G' + 'A'.repeat(55),
      syncedTo: 42,
      inserted: 2,
      scanned: 3,
      pages: 1,
      drained: true,
      occurredAt: '2026-10-17T00:00:00.000Z',
    };

    source.dispatchEvent(new MessageEvent('sync', { data: JSON.stringify(payload) }));

    expect(source.url).toBe('https://indexer.example/api/sync/stream');
    expect(onSync).toHaveBeenCalledWith(payload);
    unsubscribe();
    expect(source.close).toHaveBeenCalledOnce();
  });
});
