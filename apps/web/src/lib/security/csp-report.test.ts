import { beforeEach, describe, expect, it } from 'vitest';
import {
  allowCspReport,
  claimCspReportFingerprint,
  isHighSeverityCspViolation,
  parseCspViolation,
  resetCspReportStateForTests,
} from './csp-report';

describe('CSP report handling', () => {
  beforeEach(() => resetCspReportStateForTests());

  it('normalizes legacy and Reporting API reports while removing URL credentials and queries', () => {
    const report = parseCspViolation({
      'csp-report': {
        'document-uri': 'https://shop.example/checkout?session=secret#step',
        'violated-directive': 'script-src-elem https://evil.example/x.js',
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'https://evil.example/x.js?token=secret',
        'source-file': 'https://shop.example/app.js?user=secret',
        'line-number': 12,
      },
    });

    expect(report).toEqual({
      documentUri: 'https://shop.example/checkout',
      violatedDirective: 'script-src-elem https://evil.example/x.js',
      effectiveDirective: 'script-src-elem',
      blockedUri: 'https://evil.example/x.js',
      sourceFile: 'https://shop.example/app.js',
      lineNumber: 12,
      statusCode: null,
    });
    expect(isHighSeverityCspViolation(report!)).toBe(true);
  });

  it('rejects invalid directives and bounds report fields', () => {
    expect(parseCspViolation({ 'csp-report': { 'violated-directive': '<script>' } })).toBeNull();
    const report = parseCspViolation({
      body: {
        effectiveDirective: 'img-src',
        blockedURL: `https://example.test/${'x'.repeat(700)}`,
      },
    });
    expect(report?.blockedUri.length).toBeLessThanOrEqual(512);
    expect(isHighSeverityCspViolation(report!)).toBe(false);
  });

  it('accepts the array form emitted by the Reporting API', () => {
    expect(
      parseCspViolation([
        { type: 'csp-violation', body: { effectiveDirective: 'script-src', blockedURL: 'inline' } },
      ]),
    ).toMatchObject({ effectiveDirective: 'script-src', blockedUri: 'inline' });
  });

  it('limits reports per client and deduplicates identical fingerprints', async () => {
    for (let i = 0; i < 60; i += 1) {
      expect(await allowCspReport('client-a', 1_000)).toBe(true);
    }
    expect(await allowCspReport('client-a', 1_000)).toBe(false);
    expect(await allowCspReport('client-b', 1_000)).toBe(true);

    expect(await claimCspReportFingerprint('same-report', 1_000)).toBe(true);
    expect(await claimCspReportFingerprint('same-report', 1_001)).toBe(false);
    expect(await claimCspReportFingerprint('same-report', 602_000)).toBe(true);
  });
});
