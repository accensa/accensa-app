import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { mockWithClient, mockGetMerchantFromRequest, mockCreateSyncStream } = vi.hoisted(() => ({
  mockWithClient: vi.fn(),
  mockGetMerchantFromRequest: vi.fn(),
  mockCreateSyncStream: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ withClient: mockWithClient }));
vi.mock('@/lib/merchants', () => ({ getMerchantFromRequest: mockGetMerchantFromRequest }));
vi.mock('@/lib/sync-events', () => ({ createSyncStream: mockCreateSyncStream }));

import { GET } from './route';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

function makeRequest() {
  return new NextRequest('http://localhost/api/sync/stream');
}

beforeEach(() => {
  process.env.DATABASE_URL = 'postgres://test';
  const client = {};
  mockWithClient.mockImplementation((fn: (c: unknown) => unknown) => fn(client));
});

afterEach(() => {
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  vi.clearAllMocks();
});

describe('GET /api/sync/stream', () => {
  it('returns 500 without touching the database when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    expect(mockWithClient).not.toHaveBeenCalled();
    expect(mockCreateSyncStream).not.toHaveBeenCalled();
  });

  it('returns 401 and never opens a stream when no merchant resolves', async () => {
    mockGetMerchantFromRequest.mockResolvedValue(null);

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(mockWithClient).toHaveBeenCalledTimes(1);
    expect(mockCreateSyncStream).not.toHaveBeenCalled();
  });

  it('hands the request and merchant id to createSyncStream and returns its response as-is', async () => {
    const stub = new Response('stub');
    mockGetMerchantFromRequest.mockResolvedValue({ id: 42 });
    mockCreateSyncStream.mockReturnValue(stub);
    const request = makeRequest();

    const res = await GET(request);

    expect(res).toBe(stub);
    expect(mockCreateSyncStream).toHaveBeenCalledTimes(1);
    expect(mockCreateSyncStream).toHaveBeenCalledWith(request, 42);
  });
});
