import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const mockRequest = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('POST /api/pricing (edge) (#168)', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://dummy';
  });

  it('computes a price with markup rules', async () => {
    const res = await POST(
      mockRequest('http://localhost/api/pricing', {
        base: '100',
        merchant: 'GAAA',
        rules: { rules: [{ name: 'm', priority: 0, effect: { kind: 'markup_pct', percent: '5' } }] },
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.prices.total).toBe('105');
  });

  it('classifies the buyer region from edge headers', async () => {
    const res = await POST(
      mockRequest(
        'http://localhost/api/pricing',
        {
          base: '100',
          merchant: 'GAAA',
          rules: {
            rules: [{ name: 'eu', priority: 0, match: { geo: 'eu' }, effect: { kind: 'markup_pct', percent: '20' } }],
          },
        },
        { 'cf-ipcountry': 'DE' },
      ),
    );
    const data = await res.json();
    expect(data.region).toBe('eu');
    expect(data.prices.total).toBe('120');
  });

  it('rejects a non-decimal base', async () => {
    const res = await POST(mockRequest('http://localhost/api/pricing', { base: 'abc', merchant: 'GAAA' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('base must be a decimal string');
  });

  it('rejects a non-positive quantity', async () => {
    const res = await POST(
      mockRequest('http://localhost/api/pricing', { base: '10', merchant: 'GAAA', quantity: 0 }),
    );
    expect(res.status).toBe(400);
  });

  it('returns cache headers for edge caching', async () => {
    const res = await POST(mockRequest('http://localhost/api/pricing', { base: '10', merchant: 'GAAA' }));
    expect(res.headers.get('Cache-Control')).toContain('s-maxage');
  });
});