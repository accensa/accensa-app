import { describe, expect, it } from 'vitest';
import {
  computeDiscountAmount,
  normalizeCouponCode,
  priceBreakdown,
  validateCoupon,
  type Coupon,
} from './couponService';

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0); // 2026-09-15T12:00:00Z

function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    code: 'SPRING20',
    discount: { kind: 'percent', value: '20' },
    redeemedCount: 0,
    ...overrides,
  };
}

describe('normalizeCouponCode', () => {
  it('is case-insensitive and trims whitespace', () => {
    expect(normalizeCouponCode('  spring20 ')).toBe('SPRING20');
    expect(normalizeCouponCode('Spring20')).toBe('SPRING20');
  });
});

describe('computeDiscountAmount', () => {
  it('takes a percentage off the order', () => {
    expect(computeDiscountAmount('100', { kind: 'percent', value: '20' })).toBe('20.0000000');
    expect(computeDiscountAmount('9.99', { kind: 'percent', value: '12.5' })).toBe('1.2487500');
  });

  it('takes a fixed amount off, capped at the order amount', () => {
    expect(computeDiscountAmount('100', { kind: 'fixed', value: '5' })).toBe('5.0000000');
    expect(computeDiscountAmount('3', { kind: 'fixed', value: '5' })).toBe('3.0000000');
  });

  it('rejects malformed amounts and values', () => {
    expect(() => computeDiscountAmount('abc', { kind: 'fixed', value: '5' })).toThrow();
    expect(() => computeDiscountAmount('10', { kind: 'fixed', value: 'x' })).toThrow();
    expect(() => computeDiscountAmount('10', { kind: 'percent', value: '-1' })).toThrow();
  });
});

describe('validateCoupon', () => {
  it('accepts a valid percent coupon and reports the discount', () => {
    const result = validateCoupon(coupon(), { orderAmount: '100', now: NOW });
    expect(result).toEqual({
      ok: true,
      coupon: coupon(),
      discountAmount: '20.0000000',
      finalAmount: '80.0000000',
    });
  });

  it('accepts a valid fixed coupon', () => {
    const result = validateCoupon(coupon({ discount: { kind: 'fixed', value: '5' } }), {
      orderAmount: '100',
      now: NOW,
    });
    expect(result.ok && result.discountAmount).toBe('5.0000000');
    expect(result.ok && result.finalAmount).toBe('95.0000000');
  });

  it('rejects an unknown code', () => {
    const result = validateCoupon(null, { orderAmount: '100', now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('not-found');
      expect(result.message).toContain('not valid');
    }
  });

  it('rejects an expired coupon', () => {
    const result = validateCoupon(coupon({ expiresAt: '2026-09-15T11:59:59Z' }), {
      orderAmount: '100',
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('expired');
      expect(result.message).toContain('expired');
    }
  });

  it('accepts a coupon expiring later today', () => {
    const result = validateCoupon(coupon({ expiresAt: '2026-09-15T23:59:59Z' }), {
      orderAmount: '100',
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a coupon whose redemption limit is exhausted', () => {
    const result = validateCoupon(coupon({ maxRedemptions: 100, redeemedCount: 100 }), {
      orderAmount: '100',
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('exhausted');
      expect(result.message).toContain('redemption limit');
    }
  });

  it('accepts a coupon with redemptions still available', () => {
    const result = validateCoupon(coupon({ maxRedemptions: 100, redeemedCount: 99 }), {
      orderAmount: '100',
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it('enforces the minimum order spend', () => {
    const result = validateCoupon(coupon({ minSpend: '50' }), { orderAmount: '49.99', now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('min-spend');
      expect(result.message).toContain('50');
    }
  });

  it('accepts an order exactly at the minimum spend', () => {
    const result = validateCoupon(coupon({ minSpend: '50' }), {
      orderAmount: '50',
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it('prevents stacking unless the coupon explicitly allows it', () => {
    const stacked = validateCoupon(coupon(), {
      orderAmount: '100',
      appliedCodes: ['WELCOME10'],
      now: NOW,
    });
    expect(stacked.ok).toBe(false);
    if (!stacked.ok) {
      expect(stacked.reason).toBe('stacking-not-allowed');
      expect(stacked.message).toContain('combined');
    }

    const allowed = validateCoupon(coupon({ allowsStacking: true }), {
      orderAmount: '100',
      appliedCodes: ['WELCOME10'],
      now: NOW,
    });
    expect(allowed.ok).toBe(true);
  });

  it('allows a lone non-stacking coupon on an order with no other codes', () => {
    const result = validateCoupon(coupon(), { orderAmount: '100', now: NOW });
    expect(result.ok).toBe(true);
  });
});

describe('priceBreakdown', () => {
  it('lists the subtotal, the coupon savings line, and the total', () => {
    const result = validateCoupon(coupon(), { orderAmount: '100', now: NOW });
    if (!result.ok) throw new Error('expected valid coupon');
    const breakdown = priceBreakdown('100', result);
    expect(breakdown.lines).toEqual([
      { label: 'Subtotal', amount: '100' },
      { label: 'Coupon SPRING20', amount: '-20.0000000' },
    ]);
    expect(breakdown.total).toBe('80.0000000');
  });
});
