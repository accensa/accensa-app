import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

const { mockCreateDisputeChatStream } = vi.hoisted(() => ({
  mockCreateDisputeChatStream: vi.fn(),
}));

vi.mock('@/lib/dispute-chat-events', () => ({
  createDisputeChatStream: mockCreateDisputeChatStream,
}));

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/disputes/[id]/messages/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves dispute ID from route params and delegates to createDisputeChatStream', async () => {
    const mockResponse = new Response('stream', {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
    mockCreateDisputeChatStream.mockReturnValue(mockResponse);

    const request = new NextRequest('http://test/api/disputes/dispute-42/messages/stream');
    const response = await GET(request, params('dispute-42'));

    expect(mockCreateDisputeChatStream).toHaveBeenCalledTimes(1);
    expect(mockCreateDisputeChatStream).toHaveBeenCalledWith(request, 'dispute-42');
    expect(response).toBe(mockResponse);
  });

  it('returns SSE streaming headers', async () => {
    mockCreateDisputeChatStream.mockReturnValue(
      new Response('stream', {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      }),
    );

    const request = new NextRequest('http://test/api/disputes/d-1/messages/stream');
    const response = await GET(request, params('d-1'));

    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toContain('no-cache');
    expect(response.headers.get('Connection')).toBe('keep-alive');
  });
});
