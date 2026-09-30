import { describe, expect, it } from 'vitest';
import { createCachedIpReputationProvider, evaluatePaymentRisk } from './riskScorer';

describe('evaluatePaymentRisk', () => {
  it('scores proxy, country mismatch, and velocity evidence without exceeding 100', () => {
    const result = evaluatePaymentRisk({
      ipCountryCode: 'us',
      billingCountryCode: 'ca',
      failedAttemptsInWindow: 6,
      reputation: { isTor: true, isDatacenterProxy: true },
    });

    expect(result.score).toBe(100);
    expect(result.requiresManualReview).toBe(true);
    expect(result.countryCode).toBe('US');
    expect(result.reasons).toContain('Tor exit node');
  });

  it('leaves a residential matching-country payment low risk', () => {
    expect(
      evaluatePaymentRisk({
        ipCountryCode: 'US',
        billingCountryCode: 'us',
        failedAttemptsInWindow: 1,
      }),
    ).toMatchObject({ score: 0, requiresManualReview: false });
  });

  it('caches provider lookups for the configured lifetime', async () => {
    let calls = 0;
    const provider = createCachedIpReputationProvider(
      { lookup: async () => ({ isTor: ++calls > 0 }) },
      60_000,
    );

    await provider.lookup('203.0.113.8');
    await provider.lookup('203.0.113.8');
    expect(calls).toBe(1);
  });
});
