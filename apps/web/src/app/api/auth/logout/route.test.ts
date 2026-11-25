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

  test('answers a generic 500 when session destruction fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDestroySession.mockRejectedValueOnce(new Error('cookie store unavailable'));

    const res = await POST();
    const body = await res.text();

    expect(mockDestroySession).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
    expect(JSON.parse(body)).toEqual({ success: false, error: 'Logout failed' });
    expect(body).not.toContain('cookie store unavailable');
    expect(consoleError).toHaveBeenCalled();
    expect(consoleError.mock.calls.flat().join(' ')).toContain('cookie store unavailable');
    consoleError.mockRestore();
  });
});
