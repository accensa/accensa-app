import { expect, test, vi, describe, beforeEach } from 'vitest';
import { GET, POST } from './route';

const {
  MERCHANT,
  mockWithClient,
  mockWithMerchantClient,
  mockGetMerchantFromRequest,
  mockListNotifications,
  mockGetUnreadCount,
  mockMarkAllAsRead,
  mockMarkAsRead,
  mockDismiss,
} = vi.hoisted(() => {
  const merchant = { id: 1, address: 'GABC' };
  return {
    MERCHANT: merchant,
    mockWithClient: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({})),
    mockWithMerchantClient: vi.fn(
      async (_merchantId: number, fn: (client: unknown) => Promise<unknown>) => fn({ query: vi.fn() }),
    ),
    mockGetMerchantFromRequest: vi.fn().mockResolvedValue(merchant),
    mockListNotifications: vi.fn().mockResolvedValue([]),
    mockGetUnreadCount: vi.fn().mockResolvedValue(0),
    mockMarkAllAsRead: vi.fn().mockResolvedValue({ updated: 2 }),
    mockMarkAsRead: vi.fn().mockResolvedValue(true),
    mockDismiss: vi.fn().mockResolvedValue(true),
  };
});

vi.mock('@/lib/db', () => ({
  withClient: mockWithClient,
  withMerchantClient: mockWithMerchantClient,
  ensureSchema: vi.fn(),
}));

vi.mock('@/lib/merchants', () => ({
  getMerchantFromRequest: mockGetMerchantFromRequest,
}));

vi.mock('@/lib/notifications', () => ({
  listNotifications: mockListNotifications,
  getUnreadNotificationCount: mockGetUnreadCount,
  markAllNotificationsAsRead: mockMarkAllAsRead,
  markNotificationAsRead: mockMarkAsRead,
  dismissNotification: mockDismiss,
}));

const NOTIFICATION = {
  id: 7,
  category: 'transactions',
  title: 'Payout confirmed',
  body: '100.00 USDC settled to your account.',
  read: false,
  created_at: '2026-09-26T12:00:00.000Z',
  read_at: null,
};

function mockRequest(url: string, init?: RequestInit) {
  return new Request(url, init);
}

function post(body: unknown) {
  return mockRequest('http://localhost/api/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/notifications GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://dummy';
    mockGetMerchantFromRequest.mockResolvedValue(MERCHANT);
    mockListNotifications.mockResolvedValue([NOTIFICATION]);
    mockGetUnreadCount.mockResolvedValue(1);
  });

  test('returns the notification list and unread count', async () => {
    const res = await GET(mockRequest('http://localhost/api/notifications'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.notifications).toEqual([NOTIFICATION]);
    expect(data.unreadCount).toBe(1);
  });

  test('sends no-store cache headers so the badge is never stale', async () => {
    const res = await GET(mockRequest('http://localhost/api/notifications'));
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  test('401s when the merchant cannot be resolved', async () => {
    mockGetMerchantFromRequest.mockResolvedValue(null);
    const res = await GET(mockRequest('http://localhost/api/notifications'));
    expect(res.status).toBe(401);
  });

  test('500s when DATABASE_URL is not configured', async () => {
    delete process.env.DATABASE_URL;
    const res = await GET(mockRequest('http://localhost/api/notifications'));
    expect(res.status).toBe(500);
  });

  test('500s when the database throws', async () => {
    mockListNotifications.mockRejectedValue(new Error('db down'));
    const res = await GET(mockRequest('http://localhost/api/notifications'));
    expect(res.status).toBe(500);
  });
});

describe('/api/notifications POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://dummy';
    mockGetMerchantFromRequest.mockResolvedValue(MERCHANT);
  });

  test('mark-all-read updates every unread notification', async () => {
    const res = await POST(post({ action: 'mark-all-read' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.updated).toBe(true);
    expect(mockMarkAllAsRead).toHaveBeenCalledWith(expect.anything(), MERCHANT.id);
  });

  test('mark-read scopes to the id in the body', async () => {
    const res = await POST(post({ action: 'mark-read', id: 7 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.updated).toBe(true);
    expect(mockMarkAsRead).toHaveBeenCalledWith(expect.anything(), MERCHANT.id, 7);
  });

  test('dismiss deletes the notification', async () => {
    const res = await POST(post({ action: 'dismiss', id: 7 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.updated).toBe(true);
    expect(mockDismiss).toHaveBeenCalledWith(expect.anything(), MERCHANT.id, 7);
  });

  test('rejects an unknown action', async () => {
    const res = await POST(post({ action: 'explode' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('mark-all-read');
  });

  test('rejects mark-read without an id', async () => {
    const res = await POST(post({ action: 'mark-read' }));
    expect(res.status).toBe(400);
  });

  test('rejects a non-integer id', async () => {
    for (const id of ['7', 1.5, -1, 0]) {
      const res = await POST(post({ action: 'dismiss', id }));
      expect(res.status).toBe(400);
    }
  });

  test('rejects a malformed JSON body', async () => {
    const res = await POST(
      mockRequest('http://localhost/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
    );
    expect(res.status).toBe(400);
  });

  test('401s when the merchant cannot be resolved', async () => {
    mockGetMerchantFromRequest.mockResolvedValue(null);
    const res = await POST(post({ action: 'mark-all-read' }));
    expect(res.status).toBe(401);
  });

  test('500s when the database throws', async () => {
    mockMarkAllAsRead.mockRejectedValue(new Error('db down'));
    const res = await POST(post({ action: 'mark-all-read' }));
    expect(res.status).toBe(500);
  });
});
