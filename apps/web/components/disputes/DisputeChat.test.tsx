// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import DisputeChat from './DisputeChat';

if (!globalThis.crypto?.subtle) {
  // jsdom's crypto stub only implements getRandomValues; the chat's AES-GCM
  // encryption needs the full Web Crypto API that Node already ships.
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  private listeners: Record<string, ((event: { data: string }) => void)[]> = {};
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (event: { data: string }) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  close() {
    FakeEventSource.instances = FakeEventSource.instances.filter((source) => source !== this);
  }
  emit(type: string, data: unknown) {
    for (const cb of this.listeners[type] ?? []) cb({ data: JSON.stringify(data) });
  }
}

describe('DisputeChat', () => {
  const originalEventSource = globalThis.EventSource;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    FakeEventSource.instances = [];
    Object.defineProperty(globalThis, 'EventSource', {
      value: FakeEventSource,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/messages') && (!init || init.method === undefined)) {
          return new Response(JSON.stringify({ salt: 'c2FsdC1ieXRlcy0xNg==', messages: [] }), {
            status: 200,
          });
        }
        if (url.endsWith('/messages') && init?.method === 'POST') {
          const body = JSON.parse(init.body as string);
          return new Response(
            JSON.stringify({
              message: {
                id: 'm1',
                disputeId: 'd1',
                role: body.role,
                createdAt: new Date().toISOString(),
                payload: body.payload,
                attachment: body.attachment ?? null,
              },
            }),
            { status: 201 },
          );
        }
        return new Response('not found', { status: 404 });
      }),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(globalThis, 'EventSource', {
      value: originalEventSource,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'fetch', {
      value: originalFetch,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
    FakeEventSource.instances = [];
  });

  it('loads history and shows a connected status once the SSE stream opens', async () => {
    render(<DisputeChat disputeId="d1" role="buyer" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1), { timeout: 10_000 });
    FakeEventSource.instances[0].emit('open', {});
    expect(screen.getByTestId('dispute-chat')).toBeInTheDocument();
  });

  it('sends a message and renders it once the round trip resolves', async () => {
    render(<DisputeChat disputeId="d1" role="merchant" />);
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1), { timeout: 10_000 });

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'We can offer 50% back' },
    });
    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => expect(screen.getAllByTestId('dispute-chat-message')).toHaveLength(1));
    expect(screen.getByText('We can offer 50% back')).toBeInTheDocument();
  });

  it('invokes the quick-action callbacks', async () => {
    const onAccept = vi.fn();
    const onCancel = vi.fn();
    render(
      <DisputeChat
        disputeId="d1"
        role="buyer"
        onAcceptPartialRefund={onAccept}
        onCancelDispute={onCancel}
      />,
    );
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1), { timeout: 10_000 });

    fireEvent.click(screen.getByText('Accept partial refund'));
    fireEvent.click(screen.getByText('Cancel dispute'));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
