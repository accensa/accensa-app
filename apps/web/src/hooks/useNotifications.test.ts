import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  fetchNotifications,
  postNotificationAction,
  useNotifications,
} from './useNotifications';

const LIST_RESPONSE = {
  notifications: [
    {
      id: 1,
      category: 'transactions',
      title: 'Payout confirmed',
      body: '100.00 USDC settled.',
      read: false,
      created_at: '2026-09-26T12:00:00.000Z',
      read_at: null,
    },
  ],
  unreadCount: 1,
};

function mockFetchOnce(body: unknown, init?: ResponseInit) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), init));
}

describe('fetchNotifications', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetchOnce(LIST_RESPONSE, { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs /api/notifications with no-store caching', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const result = await fetchNotifications();

    expect(result).toEqual(LIST_RESPONSE);
    expect(fetchMock).toHaveBeenCalledWith('/api/notifications', expect.objectContaining({
      cache: 'no-store',
    }));
  });

  it('throws the server error message on a non-2xx response', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ error: 'Internal Server Error' }, { status: 500 }));
    await expect(fetchNotifications()).rejects.toThrow('Internal Server Error');
  });

  it('falls back to the status code when the error body has no message', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({}, { status: 503 }));
    await expect(fetchNotifications()).rejects.toThrow('Error 503');
  });
});

describe('postNotificationAction', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetchOnce({ updated: true }, { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the action as JSON', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const result = await postNotificationAction({ action: 'mark-all-read' });

    expect(result).toEqual({ updated: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/notifications',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark-all-read' }),
      }),
    );
  });

  it('throws the server error message on a non-2xx response', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ error: 'Unauthorized' }, { status: 401 }));
    await expect(postNotificationAction({ action: 'dismiss', id: 1 })).rejects.toThrow(
      'Unauthorized',
    );
  });
});

/**
 * The hook itself is a thin SWR wrapper; without jsdom there is no renderer,
 * so the contract tested here is that it is a function and that a harness
 * component using it renders its initial loading state through
 * renderToString. The fetch/post functions above carry the real logic.
 */
describe('useNotifications', () => {
  it('is a function', () => {
    expect(typeof useNotifications).toBe('function');
  });

  it('renders a loading harness through renderToString', () => {
    vi.stubGlobal('fetch', mockFetchOnce(LIST_RESPONSE, { status: 200 }));

    function Harness() {
      const { loading, notifications, unreadCount } = useNotifications();
      return (
        <div>
          <span data-testid="loading">{String(loading)}</span>
          <span data-testid="count">{String(unreadCount)}</span>
          <span data-testid="items">{String(notifications.length)}</span>
        </div>
      );
    }

    const html = renderToString(<Harness />);
    // SWR starts with no data, so the first render is the loading state.
    expect(html).toContain('true');
    expect(html).toContain('>0</span>');
  });
});
