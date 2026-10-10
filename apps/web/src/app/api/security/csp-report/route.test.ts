import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const { mockAllow, mockClaim, mockAlert, mockAfter } = vi.hoisted(() => ({
  mockAllow: vi.fn().mockResolvedValue(true),
  mockClaim: vi.fn().mockResolvedValue(true),
  mockAlert: vi.fn().mockResolvedValue(undefined),
  mockAfter: vi.fn((work: () => unknown) => work()),
}));

vi.mock('@/lib/security/csp-report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/csp-report')>();
  return {
    ...actual,
    allowCspReport: mockAllow,
    claimCspReportFingerprint: mockClaim,
  };
});

vi.mock('@/lib/security/alerting', () => ({ alertCspViolation: mockAlert }));
vi.mock('next/server', () => ({ after: mockAfter }));

function request(body: string, headers?: HeadersInit) {
  return new Request('https://accensa.test/api/security/csp-report', {
    method: 'POST',
    headers: { 'content-type': 'application/csp-report', ...headers },
    body,
  });
}

describe('POST /api/security/csp-report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAllow.mockResolvedValue(true);
    mockClaim.mockResolvedValue(true);
  });

  it('returns 204 and schedules high-severity alerting after report ingestion', async () => {
    const response = await POST(
      request(
        JSON.stringify({
          'csp-report': {
            'violated-directive': 'script-src-elem',
            'effective-directive': 'script-src-elem',
            'blocked-uri': 'https://evil.example/injected.js?secret=1',
          },
        }),
        { 'x-real-ip': '203.0.113.4' },
      ),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('content-type')).toBeNull();
    expect(mockAllow).toHaveBeenCalledWith('203.0.113.4');
    expect(mockAfter).toHaveBeenCalledOnce();
    expect(mockAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveDirective: 'script-src-elem',
        blockedUri: 'https://evil.example/injected.js',
      }),
    );
  });

  it('keeps response latency independent of malformed, oversized, limited, or duplicate reports', async () => {
    expect((await POST(request('{broken'))).status).toBe(204);
    expect((await POST(request('x'.repeat(16_385)))).status).toBe(204);

    mockAllow.mockResolvedValue(false);
    expect((await POST(request('{}'))).status).toBe(204);
    expect(mockClaim).not.toHaveBeenCalled();

    mockAllow.mockResolvedValue(true);
    mockClaim.mockResolvedValue(false);
    expect(
      (await POST(request(JSON.stringify({ 'csp-report': { 'violated-directive': 'img-src' } }))))
        .status,
    ).toBe(204);
    expect(mockAfter).not.toHaveBeenCalled();
  });

  it('does not alert low-severity reports', async () => {
    const response = await POST(
      request(
        JSON.stringify({
          'csp-report': {
            'violated-directive': 'img-src',
            'blocked-uri': 'https://img.example/a.png',
          },
        }),
      ),
    );
    expect(response.status).toBe(204);
    expect(mockAfter).not.toHaveBeenCalled();
  });
});
