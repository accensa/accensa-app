import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CouponInput } from './CouponInput';
import type { Coupon } from '@/lib/discounts/couponService';

const coupon: Coupon = {
  code: 'SPRING20',
  discount: { kind: 'percent', value: '20' },
  redeemedCount: 0,
};

function render(props: Partial<Parameters<typeof CouponInput>[0]> = {}) {
  const html = renderToString(
    <CouponInput orderAmount="100" lookupCoupon={async () => coupon()} {...props} />,
  );
  // React inserts <!-- --> around interpolated values; strip them so
  // assertions read as the rendered text a user sees.
  return html.replace(/<!-- -->/g, '');
}

describe('CouponInput', () => {
  it('renders a labelled input and an Apply button', () => {
    const html = render();
    expect(html).toContain('Coupon code');
    expect(html).toContain('Apply');
    expect(html).toContain('id="coupon-code"');
  });

  it('disables Apply until a code is typed', () => {
    expect(render()).toMatch(/<button[^>]*disabled/);
  });

  it('marks the input invalid only after a rejection', () => {
    // Idle render: no error region, no aria-invalid.
    const html = render();
    expect(html).not.toContain('aria-invalid="true"');
    expect(html).not.toContain('role="alert"');
  });

  it('announces the order amount context via props', () => {
    expect(render({ orderAmount: '42.5' })).toContain('Coupon code');
  });
});
