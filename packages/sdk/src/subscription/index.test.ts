import { describe, expect, it } from 'vitest';
import {
  advancePeriod,
  applyChargeResult,
  cancelAtPeriodEnd,
  cancelImmediately,
  createSubscriptionPlan,
  expireIfGraceElapsed,
  nextBillingDate,
  reactivate,
  startSubscription,
  type SubscriptionPlan,
} from './index';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function plan(
  overrides: Partial<Parameters<typeof createSubscriptionPlan>[0]> = {},
): SubscriptionPlan {
  return createSubscriptionPlan(
    {
      merchantId: 'merchant-1',
      name: 'Pro',
      amount: '10.0000000',
      asset: 'USDC',
      billingInterval: 'monthly',
      ...overrides,
    },
    'plan-1',
    NOW,
  );
}

describe('createSubscriptionPlan', () => {
  it('builds a plan with sane defaults', () => {
    const p = plan();
    expect(p.trialDays).toBe(0);
    expect(p.graceDays).toBe(3);
    expect(p.createdAt).toBe(NOW.toISOString());
  });

  it('rejects a non-decimal amount', () => {
    expect(() => plan({ amount: 'ten' })).toThrow(/amount/);
  });

  it('rejects a zero or negative amount', () => {
    expect(() => plan({ amount: '0' })).toThrow(/amount/);
  });

  it('rejects an empty name', () => {
    expect(() => plan({ name: '   ' })).toThrow(/name/);
  });
});

describe('nextBillingDate', () => {
  it('adds a week, month, or year depending on the interval', () => {
    expect(nextBillingDate('weekly', NOW).toISOString()).toBe('2026-01-08T00:00:00.000Z');
    expect(nextBillingDate('monthly', NOW).toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(nextBillingDate('annual', NOW).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('startSubscription', () => {
  it('starts active immediately when there is no trial', () => {
    const sub = startSubscription(plan(), 'GCUSTOMER', 'sub-1', NOW);
    expect(sub.status).toBe('active');
    expect(sub.currentPeriodEnd).toBe('2026-02-01T00:00:00.000Z');
  });

  it('starts trialing when the plan has a trial window', () => {
    const trialPlan = plan({ trialDays: 14 });
    const sub = startSubscription(trialPlan, 'GCUSTOMER', 'sub-1', NOW);
    expect(sub.status).toBe('trialing');
    expect(sub.currentPeriodEnd).toBe('2026-01-15T00:00:00.000Z');
  });
});

describe('the renewal state machine', () => {
  it('leaves an in-period subscription untouched', () => {
    const p = plan();
    const sub = startSubscription(p, 'GCUSTOMER', 'sub-1', NOW);
    expect(advancePeriod(sub, p, NOW)).toEqual(sub);
  });

  it('renews an active subscription once its period ends', () => {
    const p = plan();
    const sub = startSubscription(p, 'GCUSTOMER', 'sub-1', NOW);
    const renewed = advancePeriod(sub, p, new Date('2026-02-02T00:00:00.000Z'));
    expect(renewed.status).toBe('active');
    expect(renewed.currentPeriodStart).toBe(sub.currentPeriodEnd);
    expect(renewed.currentPeriodEnd).toBe('2026-03-01T00:00:00.000Z');
  });

  it('expires instead of renewing when cancelAtPeriodEnd is set', () => {
    const p = plan();
    const sub = cancelAtPeriodEnd(startSubscription(p, 'GCUSTOMER', 'sub-1', NOW));
    const advanced = advancePeriod(sub, p, new Date('2026-02-02T00:00:00.000Z'));
    expect(advanced.status).toBe('expired');
  });

  it('moves to past_due on a failed charge and opens a grace window', () => {
    const p = plan({ graceDays: 5 });
    const sub = startSubscription(p, 'GCUSTOMER', 'sub-1', NOW);
    const failed = applyChargeResult(sub, p, false, NOW);
    expect(failed.status).toBe('past_due');
    expect(failed.graceEndsAt).toBe('2026-01-06T00:00:00.000Z');
  });

  it('returns to active on a successful charge', () => {
    const p = plan();
    const sub = applyChargeResult(startSubscription(p, 'GCUSTOMER', 'sub-1', NOW), p, false, NOW);
    const recovered = applyChargeResult(sub, p, true, NOW);
    expect(recovered.status).toBe('active');
    expect(recovered.graceEndsAt).toBeNull();
  });

  it('expires a past_due subscription once its grace window elapses', () => {
    const p = plan({ graceDays: 3 });
    const sub = applyChargeResult(startSubscription(p, 'GCUSTOMER', 'sub-1', NOW), p, false, NOW);
    const stillGrace = expireIfGraceElapsed(sub, new Date('2026-01-02T00:00:00.000Z'));
    expect(stillGrace.status).toBe('past_due');
    const expired = expireIfGraceElapsed(sub, new Date('2026-01-05T00:00:00.000Z'));
    expect(expired.status).toBe('expired');
  });
});

describe('customer-initiated cancellation', () => {
  it('cancelAtPeriodEnd keeps the subscription active until the period ends', () => {
    const sub = cancelAtPeriodEnd(startSubscription(plan(), 'GCUSTOMER', 'sub-1', NOW));
    expect(sub.status).toBe('active');
    expect(sub.cancelAtPeriodEnd).toBe(true);
  });

  it('reactivate reverses a pending cancellation', () => {
    const sub = reactivate(cancelAtPeriodEnd(startSubscription(plan(), 'GCUSTOMER', 'sub-1', NOW)));
    expect(sub.cancelAtPeriodEnd).toBe(false);
  });

  it('reactivate throws once the subscription has actually ended', () => {
    const sub = cancelImmediately(startSubscription(plan(), 'GCUSTOMER', 'sub-1', NOW), NOW);
    expect(() => reactivate(sub)).toThrow(/already ended/);
  });

  it('cancelImmediately ends access right away', () => {
    const sub = cancelImmediately(startSubscription(plan(), 'GCUSTOMER', 'sub-1', NOW), NOW);
    expect(sub.status).toBe('canceled');
    expect(sub.currentPeriodEnd).toBe(NOW.toISOString());
  });
});
