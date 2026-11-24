import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import {
  broadcastSyncEvent,
  hasSubscribers,
  registerSubscriber,
  createSyncStream,
  type SyncEventPayload,
} from './sync-events';

describe('sync-events', () => {
  const samplePayload: SyncEventPayload = {
    merchant: '0x1234567890123456789012345678901234567890',
    syncedTo: 100,
    inserted: 5,
    scanned: 20,
    pages: 1,
    drained: true,
    occurredAt: '2026-11-24T12:00:00.000Z',
  };

  function createMockController() {
    return {
      enqueue: vi.fn(),
      close: vi.fn(),
      error: vi.fn(),
      desiredSize: 1,
    } as unknown as ReadableStreamDefaultController<Uint8Array>;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('registerSubscriber and hasSubscribers', () => {
    it('accurately tracks active subscribers and handles unregister cleanup', () => {
      const merchantId = 42;
      expect(hasSubscribers(merchantId)).toBe(false);

      const controller1 = createMockController();
      const unregister1 = registerSubscriber(merchantId, controller1);

      expect(hasSubscribers(merchantId)).toBe(true);

      const controller2 = createMockController();
      const unregister2 = registerSubscriber(merchantId, controller2);

      expect(hasSubscribers(merchantId)).toBe(true);

      // Unregister first subscriber
      unregister1();
      expect(controller1.close).toHaveBeenCalledTimes(1);
      expect(hasSubscribers(merchantId)).toBe(true);

      // Unregister second subscriber
      unregister2();
      expect(controller2.close).toHaveBeenCalledTimes(1);
      expect(hasSubscribers(merchantId)).toBe(false);

      // Calling unregister again is idempotent and doesn't crash
      expect(() => unregister2()).not.toThrow();
    });

    it('safely handles controller.close throwing during unregister', () => {
      const merchantId = 99;
      const controller = createMockController();
      vi.mocked(controller.close).mockImplementation(() => {
        throw new Error('already closed');
      });

      const unregister = registerSubscriber(merchantId, controller);
      expect(hasSubscribers(merchantId)).toBe(true);

      expect(() => unregister()).not.toThrow();
      expect(hasSubscribers(merchantId)).toBe(false);
    });
  });

  describe('broadcastSyncEvent', () => {
    it('encodes payloads into UTF-8 SSE frames and delivers to active subscribers', () => {
      const merchantId = 101;
      const controller = createMockController();
      const unregister = registerSubscriber(merchantId, controller);

      broadcastSyncEvent(merchantId, samplePayload);

      expect(controller.enqueue).toHaveBeenCalledTimes(1);
      const enqueuedBytes = vi.mocked(controller.enqueue).mock.calls[0][0] as Uint8Array;
      const text = new TextDecoder().decode(enqueuedBytes);

      expect(text).toBe(`event: sync\ndata: ${JSON.stringify(samplePayload)}\n\n`);

      unregister();
    });

    it('isolates broadcasts between different merchants', () => {
      const merchantA = 1;
      const merchantB = 2;

      const controllerA = createMockController();
      const controllerB = createMockController();

      const unregisterA = registerSubscriber(merchantA, controllerA);
      const unregisterB = registerSubscriber(merchantB, controllerB);

      broadcastSyncEvent(merchantA, samplePayload);

      expect(controllerA.enqueue).toHaveBeenCalledTimes(1);
      expect(controllerB.enqueue).not.toHaveBeenCalled();

      unregisterA();
      unregisterB();
    });

    it('removes dead subscriber when controller.enqueue throws without interrupting others', () => {
      const merchantId = 200;
      const failingController = createMockController();
      vi.mocked(failingController.enqueue).mockImplementation(() => {
        throw new Error('Client disconnected');
      });

      const healthyController = createMockController();

      registerSubscriber(merchantId, failingController);
      const unregisterHealthy = registerSubscriber(merchantId, healthyController);

      expect(hasSubscribers(merchantId)).toBe(true);

      broadcastSyncEvent(merchantId, samplePayload);

      expect(failingController.enqueue).toHaveBeenCalledTimes(1);
      expect(healthyController.enqueue).toHaveBeenCalledTimes(1);

      // Failing subscriber should have been removed from the registry
      broadcastSyncEvent(merchantId, samplePayload);
      expect(failingController.enqueue).toHaveBeenCalledTimes(1);
      expect(healthyController.enqueue).toHaveBeenCalledTimes(2);

      unregisterHealthy();
      expect(hasSubscribers(merchantId)).toBe(false);
    });

    it('does nothing when broadcasting to a merchant with no subscribers', () => {
      expect(() => broadcastSyncEvent(9999, samplePayload)).not.toThrow();
    });
  });

  describe('createSyncStream', () => {
    it('returns a Response with SSE headers and sets up stream', () => {
      const merchantId = 300;
      const abortController = new AbortController();
      const request = {
        signal: abortController.signal,
      } as unknown as NextRequest;

      const response = createSyncStream(request, merchantId);

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
      expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
      expect(response.headers.get('Connection')).toBe('keep-alive');
      expect(response.headers.get('X-Accel-Buffering')).toBe('no');

      // The stream's start method runs when a reader is acquired or stream starts
      const reader = response.body?.getReader();
      expect(hasSubscribers(merchantId)).toBe(true);

      // Aborting the request triggers cleanup
      abortController.abort();
      expect(hasSubscribers(merchantId)).toBe(false);

      reader?.cancel();
    });
  });
});
