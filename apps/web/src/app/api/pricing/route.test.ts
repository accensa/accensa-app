import { describe, it, expect, beforeEach } from 'vitest';
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
        rules: {
          rules: [{ name: 'm', priority: 0, effect: { kind: 'markup_pct', percent: '5' } }],
        },
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
            rules: [
              {
                name: 'eu',
                priority: 0,
                match: { geo: 'eu' },
                effect: { kind: 'markup_pct', percent: '20' },
              },
            ],
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
    const res = await POST(
      mockRequest('http://localhost/api/pricing', { base: 'abc', merchant: 'GAAA' }),
    );
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
    const res = await POST(
      mockRequest('http://localhost/api/pricing', { base: '10', merchant: 'GAAA' }),
    );
    expect(res.headers.get('Cache-Control')).toContain('s-maxage');
  });

  it('rejects a body that is not JSON', async () => {
    // JSON.stringify(undefined) is undefined, so the helper sends an empty body.
    const res = await POST(mockRequest('http://localhost/api/pricing', undefined));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('invalid_json');
  });

  it.each([
    ['missing', { base: '10' }],
    ['blank', { base: '10', merchant: '' }],
    ['not a string', { base: '10', merchant: 42 }],
  ])('rejects a %s merchant', async (_label, body) => {
    const res = await POST(mockRequest('http://localhost/api/pricing', body));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('merchant is required');
  });

  it.each([
    ['an array', []],
    ['an object without rules.rules', {}],
    ['an object whose rules.rules is not an array', { rules: 'markup' }],
    ['a string', 'markup'],
  ])('rejects a rules value that is %s', async (_label, rules) => {
    const res = await POST(
      mockRequest('http://localhost/api/pricing', { base: '10', merchant: 'GAAA', rules }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('rules must be a pricing rules object');
  });

  it('returns a thrown engine error as 400 carrying the thrown message', async () => {
    const res = await POST(
      mockRequest('http://localhost/api/pricing', {
        base: '10',
        merchant: 'GAAA',
        rules: {
          rules: [{ name: 'bad', priority: 0, effect: { kind: 'markup_pct', percent: 'abc' } }],
        },
      }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("PriceEngine: invalid decimal 'abc'");
  });

  it.each([
    { country: undefined, region: 'auto' },
    { country: 'US', region: 'na' },
    { country: 'CA', region: 'na' },
    { country: 'MX', region: 'na' },
    { country: 'DE', region: 'eu' },
    { country: 'GB', region: 'eu' },
    { country: 'JP', region: 'apac' },
    { country: 'AU', region: 'apac' },
    { country: 'BR', region: 'latam' },
    { country: 'AR', region: 'latam' },
    { country: 'NG', region: 'africa' },
    { country: 'ZA', region: 'africa' },
    { country: 'CN', region: 'other' },
    { country: 'XX', region: 'other' },
  ])('classifies cf-ipcountry $country as region $region', async ({ country, region }) => {
    const headers: Record<string, string> = country ? { 'cf-ipcountry': country } : {};
    const res = await POST(
      mockRequest('http://localhost/api/pricing', { base: '10', merchant: 'GAAA' }, headers),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.region).toBe(region);
  });

  it('prefers cf-ipcountry over x-vercel-ip-country when both are present and disagree', async () => {
    const res = await POST(
      mockRequest(
        'http://localhost/api/pricing',
        { base: '10', merchant: 'GAAA' },
        { 'cf-ipcountry': 'DE', 'x-vercel-ip-country': 'US' },
      ),
    );
    const data = await res.json();
    expect(data.region).toBe('eu');
  });

  it('falls back to x-vercel-ip-country when cf-ipcountry is absent', async () => {
    const res = await POST(
      mockRequest(
        'http://localhost/api/pricing',
        { base: '10', merchant: 'GAAA' },
        { 'x-vercel-ip-country': 'US' },
      ),
    );
    const data = await res.json();
    expect(data.region).toBe('na');
  });

  it('classifies a lowercase country code the same as its uppercase form', async () => {
    const body = { base: '10', merchant: 'GAAA' };
    const lower = await POST(
      mockRequest('http://localhost/api/pricing', body, { 'cf-ipcountry': 'de' }),
    );
    const upper = await POST(
      mockRequest('http://localhost/api/pricing', body, { 'cf-ipcountry': 'DE' }),
    );
    const lowerData = await lower.json();
    const upperData = await upper.json();
    expect(lowerData.region).toBe('eu');
    expect(lowerData.region).toBe(upperData.region);
  });
});
