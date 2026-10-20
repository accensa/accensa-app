import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { DisputeChatMessage } from './dispute-chat-store';
import { broadcastDisputeChatMessage, createDisputeChatStream } from './dispute-chat-events';

interface ControllerHarness {
  enqueue: ReturnType<typeof vi.fn<(chunk: Uint8Array) => void>>;
  close: ReturnType<typeof vi.fn<() => void>>;
  chunks: Uint8Array[];
}

const controllers: ControllerHarness[] = [];
const abortControllers: AbortController[] = [];

function makeController(): ControllerHarness {
  const chunks: Uint8Array[] = [];
  const enqueue = vi.fn((chunk: Uint8Array) => chunks.push(chunk));
  const close = vi.fn();
  const controller = { enqueue, close, chunks };
  controllers.push(controller);
  return controller;
}

class FakeReadableStream {
  constructor(source: { start(controller: ReadableStreamDefaultController<Uint8Array>): void }) {
    source.start(makeController() as unknown as ReadableStreamDefaultController<Uint8Array>);
  }
}

class FakeResponse {
  constructor(
    readonly body: unknown,
    readonly init: ResponseInit,
  ) {}
}

function subscribe(disputeId: string) {
  const abortController = new AbortController();
  abortControllers.push(abortController);
  const request = { signal: abortController.signal } as NextRequest;
  createDisputeChatStream(request, disputeId);
  return { abortController, controller: controllers[controllers.length - 1]! };
}

function decoded(chunk: Uint8Array): string {
  return new TextDecoder().decode(chunk);
}

afterEach(() => {
  for (const controller of abortControllers) controller.abort();
  abortControllers.length = 0;
  controllers.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('dispute chat SSE relay', () => {
  beforeEach(() => {
    vi.stubGlobal('ReadableStream', FakeReadableStream);
    vi.stubGlobal('Response', FakeResponse);
  });

  it('frames and broadcasts a message to the subscribed client', () => {
    const { controller } = subscribe('dispute-1');
    const message: DisputeChatMessage = {
      id: 'message-1',
      disputeId: 'dispute-1',
      role: 'buyer',
      createdAt: '2026-10-18T00:00:00.000Z',
      payload: { iv: 'iv', ciphertext: 'ciphertext' },
      attachment: null,
    };

    broadcastDisputeChatMessage('dispute-1', message);

    expect(controller.enqueue).toHaveBeenCalledOnce();
    expect(decoded(controller.chunks[0]!)).toBe(
      `event: message\ndata: ${JSON.stringify(message)}\n\n`,
    );
  });

  it('drops a subscriber whose controller has closed', () => {
    const failed = subscribe('dispute-2').controller;
    failed.enqueue.mockImplementation(() => {
      throw new Error('stream is closed');
    });
    const active = subscribe('dispute-2').controller;
    const message = {
      id: 'message-2',
      disputeId: 'dispute-2',
      role: 'merchant',
      createdAt: '2026-10-18T00:00:00.000Z',
      payload: { iv: 'iv', ciphertext: 'ciphertext' },
      attachment: null,
    } satisfies DisputeChatMessage;

    broadcastDisputeChatMessage('dispute-2', message);
    broadcastDisputeChatMessage('dispute-2', message);

    expect(failed.enqueue).toHaveBeenCalledOnce();
    expect(active.enqueue).toHaveBeenCalledTimes(2);
  });

  it('unregisters and closes a subscriber when its request aborts', () => {
    const { abortController, controller } = subscribe('dispute-3');
    abortController.abort();

    broadcastDisputeChatMessage('dispute-3', {
      id: 'message-3',
      disputeId: 'dispute-3',
      role: 'buyer',
      createdAt: '2026-10-18T00:00:00.000Z',
      payload: { iv: 'iv', ciphertext: 'ciphertext' },
      attachment: null,
    });

    expect(controller.close).toHaveBeenCalledOnce();
    expect(controller.enqueue).not.toHaveBeenCalled();
  });

  it('sends heartbeat frames with an ISO timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T12:00:00.000Z'));
    const { controller } = subscribe('dispute-4');

    vi.advanceTimersByTime(25_000);

    expect(decoded(controller.chunks[0]!)).toBe(
      'event: heartbeat\ndata: {"at":"2026-10-18T12:00:25.000Z"}\n\n',
    );
  });
});
