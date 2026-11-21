import { expect, test, vi, describe, beforeEach } from 'vitest';
import { POST } from './route';

const { mockDestroySession } = vi.hoisted(() => ({
  mockDestroySession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/auth', () => ({
  destroySession: mockDestroySession,
}));

describe('/api/auth/logout POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('destroys the session and returns success', async () => {
    const res = await POST();

    expect(mockDestroySession).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
  });

  test('does not report success when session destruction fails', async () => {
    mockDestroySession.mockRejectedValueOnce(new Error('cookie store unavailable'));

    await expect(POST()).rejects.toThrow('cookie store unavailable');
    expect(mockDestroySession).toHaveBeenCalledTimes(1);
  });
});
