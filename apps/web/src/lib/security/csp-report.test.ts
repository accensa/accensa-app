import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  allowCspReport,
  claimCspReportFingerprint,
  getLocalHitsSizeForTests,
  isHighSeverityCspViolation,
  MAX_TRACKED_CLIENTS,
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

  it('removes expired keys by a later call and shrinks the size', async () => {
    expect(await allowCspReport('client-1', 1_000)).toBe(true);
    expect(await allowCspReport('client-2', 1_000)).toBe(true);
    expect(getLocalHitsSizeForTests()).toBe(2);

    // At t = 62,000 (> 1,000 + 60,000), client-1 and client-2 are expired.
    // Calling for client-3 sweeps both expired keys and registers client-3.
    expect(await allowCspReport('client-3', 62_000)).toBe(true);
    expect(getLocalHitsSizeForTests()).toBe(1);
  });

  it('does not retain empty arrays', async () => {
    expect(await allowCspReport('client-empty', 1_000)).toBe(true);
    expect(getLocalHitsSizeForTests()).toBe(1);

    // Advance time past the window and trigger a call
    expect(await allowCspReport('client-fresh', 65_000)).toBe(true);
    expect(getLocalHitsSizeForTests()).toBe(1);
  });

  it('bounds the tracker size to the cap while allowing correct decisions for recent clients', async () => {
    const totalKeys = MAX_TRACKED_CLIENTS + 50;
    const now = 10_000;

    for (let i = 0; i < totalKeys; i++) {
      const allowed = await allowCspReport(`bulk-client-${i}`, now);
      expect(allowed).toBe(true);
      expect(getLocalHitsSizeForTests()).toBeLessThanOrEqual(MAX_TRACKED_CLIENTS);
    }

    expect(getLocalHitsSizeForTests()).toBe(MAX_TRACKED_CLIENTS);

    // The most recently added client should still be recognized and tracked
    const lastKey = `bulk-client-${totalKeys - 1}`;
    expect(await allowCspReport(lastKey, now + 1_000)).toBe(true);
    expect(getLocalHitsSizeForTests()).toBe(MAX_TRACKED_CLIENTS);
  });

  it('evicts stale keys before windowed ones', async () => {
    // client-old at t = 10_000
    expect(await allowCspReport('client-old', 10_000)).toBe(true);
    // client-recent at t = 50_000
    expect(await allowCspReport('client-recent', 50_000)).toBe(true);
    expect(getLocalHitsSizeForTests()).toBe(2);

    // At t = 75_000:
    // client-old hit was at 10,000 (75_000 - 10_000 = 65_000 > 60_000 WINDOW_MS -> stale)
    // client-recent hit was at 50,000 (75_000 - 50_000 = 25_000 < 60_000 WINDOW_MS -> live)
    // When client-new arrives, client-old is swept first
    expect(await allowCspReport('client-new', 75_000)).toBe(true);
    expect(getLocalHitsSizeForTests()).toBe(2); // client-recent and client-new

    // client-recent is still within window and has 1 hit recorded; sending 59 more hits should be accepted, then 60th denied
    for (let i = 0; i < 58; i++) {
      expect(await allowCspReport('client-recent', 75_000)).toBe(true);
    }
    expect(await allowCspReport('client-recent', 75_000)).toBe(true); // 60th hit total
    expect(await allowCspReport('client-recent', 75_000)).toBe(false); // 61st hit total denied
  });

  it('denies a client over the limit inside the window while it fits', async () => {
    const now = 20_000;
    for (let i = 0; i < 60; i++) {
      expect(await allowCspReport('spam-client', now)).toBe(true);
    }
    // 61st and 62nd inside window should be denied
    expect(await allowCspReport('spam-client', now)).toBe(false);
    expect(await allowCspReport('spam-client', now + 500)).toBe(false);
  });

  it('matches reference sliding-window decisions on a fixed pseudo-random replay', async () => {
    // Reference implementation of the sliding-window limiter without the cap
    class ReferenceLimiter {
      private readonly hits = new Map<string, number[]>();

      allow(clientKey: string, now: number): boolean {
        const id = createHash('sha256').update(clientKey).digest('hex');
        const current = (this.hits.get(id) ?? []).filter((h) => h > now - 60_000);
        if (current.length >= 60) {
          this.hits.set(id, current);
          return false;
        }
        current.push(now);
        this.hits.set(id, current);
        return true;
      }
    }

    const ref = new ReferenceLimiter();
    const clients = ['client-alpha', 'client-beta', 'client-gamma', 'client-delta', 'client-epsilon'];

    // Linear Congruential Generator (LCG) for deterministic pseudo-random sequence
    let seed = 123456789;
    const lcg = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    let currentTime = 100_000;
    for (let step = 0; step < 300; step++) {
      const clientIndex = Math.floor(lcg() * clients.length);
      const client = clients[clientIndex];
      // Advance time between 0ms and 1500ms
      currentTime += Math.floor(lcg() * 1500);

      const expected = ref.allow(client, currentTime);
      const actual = await allowCspReport(client, currentTime);

      expect(actual).toBe(expected);
    }
  });
});
