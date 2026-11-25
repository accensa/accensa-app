import { describe, expect, it } from 'vitest';
import { POST } from './route';

const coupon = {
  code: 'SPRING20',
  discount: { kind: 'percent', value: '20' },
  redeemedCount: 0,
};

const request = (body: unknown) =>
  new Request('http://localhost/api/coupons/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/coupons/validate', () => {
  it('returns discount calculations for a matching coupon', async () => {
    const response = await POST(request({ code: ' spring20 ', orderAmount: '100', coupon }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      ok: true,
      coupon,
      discountAmount: '20.0000000',
      finalAmount: '80.0000000',
    });
  });

  it('returns a typed 422 rejection for an exhausted coupon', async () => {
    const response = await POST(
      request({
        code: coupon.code,
        orderAmount: '100',
        coupon: { ...coupon, maxRedemptions: 1, redeemedCount: 1 },
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      reason: 'exhausted',
      message: 'This code has reached its redemption limit.',
    });
  });

  it('rejects a coupon rule that does not match the requested code', async () => {
    const response = await POST(request({ code: 'OTHER', orderAmount: '100', coupon }));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      reason: 'not-found',
      message: 'That code is not valid.',
    });
  });

  it('returns typed validation reasons from the coupon engine', async () => {
    const response = await POST(
      request({
        code: coupon.code,
        orderAmount: '49',
        appliedCodes: ['WELCOME'],
        coupon: { ...coupon, minSpend: '50' },
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      reason: 'min-spend',
      message: 'This code needs an order of at least 50.',
    });
  });

  it.each([
    [
      'invalid JSON',
      new Request('http://localhost/api/coupons/validate', { method: 'POST', body: '{' }),
    ],
    ['an array body', []],
    ['a missing code', { orderAmount: '10', coupon }],
    ['a blank code', { code: '  ', orderAmount: '10', coupon }],
    ['a numeric order amount', { code: coupon.code, orderAmount: 10, coupon }],
    ['a malformed order amount', { code: coupon.code, orderAmount: '1e2', coupon }],
    [
      'an amount with unsupported precision',
      { code: coupon.code, orderAmount: '1.00000001', coupon },
    ],
    ['invalid applied codes', { code: coupon.code, orderAmount: '10', appliedCodes: [''], coupon }],
    [
      'a malformed coupon rule',
      {
        code: coupon.code,
        orderAmount: '10',
        coupon: { ...coupon, discount: { kind: 'fixed', value: '-1' } },
      },
    ],
    ['a missing coupon', { code: coupon.code, orderAmount: '10' }],
  ])('returns 400 for %s', async (_label, body) => {
    const response = body instanceof Request ? await POST(body) : await POST(request(body));

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('does not allow a non-stackable coupon alongside applied codes', async () => {
    const response = await POST(
      request({ code: coupon.code, orderAmount: '100', appliedCodes: ['WELCOME'], coupon }),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).reason).toBe('stacking-not-allowed');
  });
});
