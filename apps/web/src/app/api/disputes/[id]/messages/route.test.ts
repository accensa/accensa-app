import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';
import { __resetDisputeChatStore, listMessages } from '@/lib/dispute-chat-store';

const { mockBroadcastDisputeChatMessage } = vi.hoisted(() => ({
  mockBroadcastDisputeChatMessage: vi.fn(),
}));

vi.mock('@/lib/dispute-chat-events', () => ({
  broadcastDisputeChatMessage: mockBroadcastDisputeChatMessage,
}));

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('disputes/[id]/messages route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('returns 400 when the request body is not valid JSON and does not append or broadcast', async () => {
    const request = new Request('http://test/api/disputes/d1/messages', {
      method: 'POST',
      body: 'invalid-json{',
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(request, params('d1'));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Request body must be JSON');
    expect(mockBroadcastDisputeChatMessage).not.toHaveBeenCalled();
    expect(listMessages('d1')).toEqual([]);
  });

  it('rejects with 400 payloads missing ciphertext, missing iv, or having a numeric iv via the encrypted payload guard', async () => {
    const invalidPayloads = [
      { ciphertext: 'test-cipher' }, // missing iv
      { iv: 'test-iv' }, // missing ciphertext
      { ciphertext: 'test-cipher', iv: 12345 }, // numeric iv
    ];

    for (const invalidPayload of invalidPayloads) {
      const request = new Request('http://test/api/disputes/d1/messages', {
        method: 'POST',
        body: JSON.stringify({ role: 'buyer', payload: invalidPayload }),
      });
      const response = await POST(request, params('d1'));
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe(
        'payload must be an encrypted { ciphertext, iv } produced client-side',
      );
    }
    expect(mockBroadcastDisputeChatMessage).not.toHaveBeenCalled();
    expect(listMessages('d1')).toEqual([]);
  });

  it('broadcasts exactly once with the dispute id from the path and the 201 response message', async () => {
    const request = new Request('http://test/api/disputes/d-path-id/messages', {
      method: 'POST',
      body: JSON.stringify({
        role: 'buyer',
        payload: { ciphertext: 'cipher123', iv: 'iv123' },
      }),
    });
    const response = await POST(request, params('d-path-id'));
    expect(response.status).toBe(201);
    const { message } = await response.json();

    expect(mockBroadcastDisputeChatMessage).toHaveBeenCalledTimes(1);
    expect(mockBroadcastDisputeChatMessage).toHaveBeenCalledWith('d-path-id', message);
  });

  it('ignores client-supplied id and createdAt and assigns server-generated UUID and ISO timestamp', async () => {
    const clientSuppliedId = 'client-id-override';
    const clientSuppliedCreatedAt = '2020-01-01T00:00:00.000Z';

    const request = new Request('http://test/api/disputes/d1/messages', {
      method: 'POST',
      body: JSON.stringify({
        id: clientSuppliedId,
        createdAt: clientSuppliedCreatedAt,
        role: 'buyer',
        payload: { ciphertext: 'cipher-secure', iv: 'iv-secure' },
      }),
    });
    const response = await POST(request, params('d1'));
    expect(response.status).toBe(201);
    const { message } = await response.json();

    expect(message.id).not.toBe(clientSuppliedId);
    expect(message.createdAt).not.toBe(clientSuppliedCreatedAt);
    // Standard RFC 4122 UUID v4 regex
    expect(message.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(new Date(message.createdAt).toISOString()).toBe(message.createdAt);

    const stored = listMessages('d1')[0];
    expect(stored.id).toBe(message.id);
    expect(stored.createdAt).toBe(message.createdAt);
  });

  it('stores omitted attachment as null and preserves a supplied attachment unchanged', async () => {
    // 1. Omitted attachment
    const omittedReq = new Request('http://test/api/disputes/d1/messages', {
      method: 'POST',
      body: JSON.stringify({
        role: 'buyer',
        payload: { ciphertext: 'c1', iv: 'i1' },
      }),
    });
    const omittedRes = await POST(omittedReq, params('d1'));
    expect(omittedRes.status).toBe(201);
    const { message: omittedMsg } = await omittedRes.json();
    expect(omittedMsg.attachment).toBeNull();
    expect(listMessages('d1')[0].attachment).toBeNull();

    // 2. Supplied attachment
    const attachmentData = {
      name: 'invoice.pdf',
      contentType: 'application/pdf',
      dataUrl: 'data:application/pdf;base64,aGVsbG8=',
    };
    const suppliedReq = new Request('http://test/api/disputes/d1/messages', {
      method: 'POST',
      body: JSON.stringify({
        role: 'merchant',
        payload: { ciphertext: 'c2', iv: 'i2' },
        attachment: attachmentData,
      }),
    });
    const suppliedRes = await POST(suppliedReq, params('d1'));
    expect(suppliedRes.status).toBe(201);
    const { message: suppliedMsg } = await suppliedRes.json();
    expect(suppliedMsg.attachment).toEqual(attachmentData);
    expect(listMessages('d1')[1].attachment).toEqual(attachmentData);
  });

  it('reads salt and messages for the path dispute id on GET', async () => {
    const postRes = await POST(
      new Request('http://test/api/disputes/d-get-test/messages', {
        method: 'POST',
        body: JSON.stringify({
          role: 'buyer',
          payload: { ciphertext: 'c-get', iv: 'i-get' },
        }),
      }),
      params('d-get-test'),
    );
    const { message: postedMessage } = await postRes.json();

    const getRes = await GET(
      new Request('http://test/api/disputes/d-get-test/messages'),
      params('d-get-test'),
    );
    const data = await getRes.json();
    expect(data.messages).toEqual([postedMessage]);
    expect(typeof data.salt).toBe('string');
    expect(data.salt.length).toBeGreaterThan(0);
  });
});
