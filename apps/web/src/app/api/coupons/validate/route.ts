import { NextResponse } from 'next/server';
import { normalizeCouponCode, validateCoupon, type Coupon } from '@/lib/discounts/couponService';

export const dynamic = 'force-dynamic';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDecimalAmount(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(?:\.\d{1,7})?$/.test(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
}

function isCoupon(value: unknown): value is Coupon {
  if (!isRecord(value) || typeof value.code !== 'string' || !value.code.trim()) return false;
  if (!isRecord(value.discount) || !isDecimalAmount(value.discount.value)) return false;
  if (value.discount.kind !== 'percent' && value.discount.kind !== 'fixed') return false;
  if (!isNonNegativeSafeInteger(value.redeemedCount)) return false;
  if (value.maxRedemptions !== undefined && !isNonNegativeSafeInteger(value.maxRedemptions))
    return false;
  if (value.minSpend !== undefined && !isDecimalAmount(value.minSpend)) return false;
  if (
    value.expiresAt !== undefined &&
    value.expiresAt !== null &&
    (typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)))
  ) {
    return false;
  }
  if (value.allowsStacking !== undefined && typeof value.allowsStacking !== 'boolean') return false;
  return true;
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be JSON' }, 400);
  }

  if (!isRecord(body)) return json({ error: 'Request body must be a JSON object' }, 400);

  const { code, orderAmount, appliedCodes, coupon } = body;
  if (typeof code !== 'string' || !code.trim()) {
    return json({ error: 'code is required' }, 400);
  }
  if (!isDecimalAmount(orderAmount)) {
    return json(
      { error: 'orderAmount must be a non-negative decimal string with at most 7 decimal places' },
      400,
    );
  }
  if (appliedCodes !== undefined && !isStringArray(appliedCodes)) {
    return json({ error: 'appliedCodes must be an array of non-empty strings' }, 400);
  }
  if (!('coupon' in body) || (coupon !== null && !isCoupon(coupon))) {
    return json({ error: 'coupon must be a coupon object or null' }, 400);
  }

  const matchingCoupon =
    coupon && normalizeCouponCode(code) === normalizeCouponCode(coupon.code) ? coupon : null;
  const result = validateCoupon(matchingCoupon, {
    orderAmount,
    appliedCodes,
  });

  return json(result, result.ok ? 200 : 422);
}
