import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { cacheStore, mockWithClient, mockEnsureSchema, mockGetPublicReceiptShare, mockNotFound } =
  vi.hoisted(() => ({
    cacheStore: new Map<string, unknown>(),
    mockWithClient: vi.fn(),
    mockEnsureSchema: vi.fn().mockResolvedValue(undefined),
    mockGetPublicReceiptShare: vi.fn(),
    mockNotFound: vi.fn(),
  }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    cache: <T extends (...args: never[]) => Promise<unknown>>(fn: T) =>
      ((...args: Parameters<T>) => {
        const key = JSON.stringify(args);
        if (!cacheStore.has(key)) cacheStore.set(key, fn(...args));
        return cacheStore.get(key);
      }) as T,
  };
});

vi.mock('@/lib/db', () => ({
  withClient: mockWithClient,
  ensureSchema: mockEnsureSchema,
}));

vi.mock('@/lib/receipt-share', () => ({
  getPublicReceiptShare: mockGetPublicReceiptShare,
}));

vi.mock('next/navigation', () => ({ notFound: mockNotFound }));

import PublicReceiptPage, { generateMetadata } from './page';

const HASH = 'AB'.repeat(32);
const MERCHANT = 'GCALKSGAZRJLSUEJT3M5W6LN4R7XQOLIRCOS6ZA6EDZVTZDBIIPPFKJ6';
const RECEIPT = {
  txHash: HASH.toLowerCase(),
  merchantAddress: MERCHANT,
  amount: '10',
  asset: 'native',
  batchId: 42,
};

describe('public receipt page request-scoped lookup', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    cacheStore.clear();
    process.env.DATABASE_URL = 'postgres://dummy';
    mockWithClient.mockImplementation(async (fn: (client: unknown) => Promise<unknown>) => fn({}));
    mockGetPublicReceiptShare.mockResolvedValue(RECEIPT);
    mockNotFound.mockImplementation(() => {
      throw new Error('not-found');
    });
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('runs one withClient while metadata and body render', async () => {
    const params = Promise.resolve({ txHash: HASH });

    const metadata = await generateMetadata({ params });
    const html = renderToString(await PublicReceiptPage({ params }));

    expect(mockWithClient).toHaveBeenCalledTimes(1);
    expect(mockEnsureSchema).toHaveBeenCalledTimes(1);
    expect(mockGetPublicReceiptShare).toHaveBeenCalledWith({}, HASH.toLowerCase());
    expect(metadata.description).toContain('10.00 XLM');
    expect(JSON.stringify(metadata)).toContain('batch #42');
    expect(html).toContain(`${MERCHANT.slice(0, 7)}…${MERCHANT.slice(-5)}`);
    expect(html).toMatch(/Receipt batch #(?:<!-- -->)?42/);
  });

  it('reaches notFound for an unknown hash without touching the database', async () => {
    const params = Promise.resolve({ txHash: 'too-short' });

    expect(await generateMetadata({ params })).toEqual({
      title: 'Receipt unavailable | Accensa',
    });
    await expect(PublicReceiptPage({ params })).rejects.toThrow('not-found');

    expect(mockNotFound).toHaveBeenCalledTimes(1);
    expect(mockWithClient).not.toHaveBeenCalled();
  });
});
