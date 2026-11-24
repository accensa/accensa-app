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

describe('disputes/[id]/messages/stream route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['numeric id', '42'],
    ['non-numeric id', 'd-1_2'],
    ['512-character id', 'x'.repeat(512)],
  ])('%s: forwards id unchanged and returns mock response', async (_, id) => {
    const mockResponse = new Response('stream');
    mockCreateDisputeChatStream.mockReturnValue(mockResponse);

    const request = new NextRequest('http://test/api/disputes/' + id + '/messages/stream');
    const result = await GET(request, params(id));

    expect(mockCreateDisputeChatStream).toHaveBeenCalledTimes(1);
    expect(mockCreateDisputeChatStream).toHaveBeenCalledWith(request, id);
    expect(result).toBe(mockResponse);
  });
});
