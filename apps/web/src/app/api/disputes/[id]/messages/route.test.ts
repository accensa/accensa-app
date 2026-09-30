import { beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './route';
import { __resetDisputeChatStore } from '@/lib/dispute-chat-store';

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('disputes/[id]/messages route', () => {
  beforeEach(() => {
    __resetDisputeChatStore();
  });

  it('returns an empty history and a fresh salt for a new dispute', async () => {
    const response = await GET(new Request('http://test/api/disputes/d1/messages'), params('d1'));
    const body = await response.json();
    expect(body.messages).toEqual([]);
    expect(typeof body.salt).toBe('string');
    expect(body.salt.length).toBeGreaterThan(0);
  });

  it('rejects a POST with an invalid role', async () => {
    const request = new Request('http://test/api/disputes/d1/messages', {
      method: 'POST',
      body: JSON.stringify({ role: 'admin', payload: { ciphertext: 'a', iv: 'b' } }),
    });
    const response = await POST(request, params('d1'));
    expect(response.status).toBe(400);
  });

  it('rejects a POST without an encrypted payload', async () => {
    const request = new Request('http://test/api/disputes/d1/messages', {
      method: 'POST',
      body: JSON.stringify({ role: 'buyer', payload: { text: 'plaintext leak' } }),
    });
    const response = await POST(request, params('d1'));
    expect(response.status).toBe(400);
  });

  it('appends a valid message and makes it visible to a subsequent GET', async () => {
    const request = new Request('http://test/api/disputes/d1/messages', {
      method: 'POST',
      body: JSON.stringify({
        role: 'merchant',
        payload: { ciphertext: 'cGxhaW50ZXh0', iv: 'aXYtYnl0ZXM=' },
      }),
    });
    const postResponse = await POST(request, params('d1'));
    expect(postResponse.status).toBe(201);
    const { message } = await postResponse.json();
    expect(message.role).toBe('merchant');
    expect(message.disputeId).toBe('d1');

    const getResponse = await GET(
      new Request('http://test/api/disputes/d1/messages'),
      params('d1'),
    );
    const { messages } = await getResponse.json();
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(message.id);
  });

  it('keeps separate disputes rooms independent', async () => {
    await POST(
      new Request('http://test/api/disputes/d1/messages', {
        method: 'POST',
        body: JSON.stringify({ role: 'buyer', payload: { ciphertext: 'x', iv: 'y' } }),
      }),
      params('d1'),
    );
    const getResponse = await GET(
      new Request('http://test/api/disputes/d2/messages'),
      params('d2'),
    );
    const { messages } = await getResponse.json();
    expect(messages).toEqual([]);
  });
});
