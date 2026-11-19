import { expect, test, vi, describe, beforeEach } from 'vitest';
import { POST } from './route';

const MERCHANT_ADDRESS = 'GCALKSGAZRJLSUEJT3M5W6LN4R7XQOLIRCOS6ZA6EDZVTZDBIIPPFKJ6';

const { mockCreateSession } = vi.hoisted(() => ({
  mockCreateSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/auth', () => ({
  createSession: mockCreateSession,
}));

function renewRequest(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/auth/renew', {
    method: 'POST',
    headers,
  });
}

describe('/api/auth/renew POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns 401 when x-accensa-merchant is absent', async () => {
    const res = await POST(renewRequest());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  test('treats an empty x-accensa-merchant as absent', async () => {
    const res = await POST(renewRequest({ 'x-accensa-merchant': '' }));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  test('creates a session for the header merchant and returns success', async () => {
    const res = await POST(renewRequest({ 'x-accensa-merchant': MERCHANT_ADDRESS }));

    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).toHaveBeenCalledWith(MERCHANT_ADDRESS);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
  });

  test('does not report success when session creation fails', async () => {
    mockCreateSession.mockRejectedValueOnce(new Error('JWT_SECRET_KEY is not set'));

    await expect(POST(renewRequest({ 'x-accensa-merchant': MERCHANT_ADDRESS }))).rejects.toThrow(
      'JWT_SECRET_KEY is not set',
    );
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
  });
});
