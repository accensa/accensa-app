/**
 * Coupon & promotional code validation engine (#432).
 *
 * Merchants configure coupon codes with a percentage or fixed-amount
 * discount, an optional minimum order spend, an optional redemption cap,
 * and an optional expiry. Validation runs client-side (instant feedback in
 * the checkout UI) and is designed to be re-run server-side before a
 * discount is applied to an authorization amount — the same pure function
 * backs both, so the two can never disagree about what a code is worth.
 *
 * Money never touches a float: amounts are decimal strings folded in
 * integer stroops via `lib/money`, exactly like the pricing engine.
 */

import { fromStroops, toStroops } from '@/lib/money';

/** A coupon rule as a merchant configures it. */
export interface Coupon {
  /** The code the buyer types, e.g. `SPRING20`. Compared case-insensitively. */
  code: string;
  /** What the code takes off the order. */
  discount: { kind: 'percent'; value: string } | { kind: 'fixed'; value: string };
  /** Minimum order spend for the code to apply, as a decimal string. */
  minSpend?: string;
  /** Maximum total redemptions. Omitted means unlimited. */
  maxRedemptions?: number;
  /** Redemptions so far. Compared against `maxRedemptions`. */
  redeemedCount: number;
  /** ISO 8601 expiry. Omitted means the code never expires. */
  expiresAt?: string | null;
  /**
   * Whether this code may combine with other codes on the same order.
   * Defaults to false — stacking is opt-in, because an unstackable code
   * silently beating a stackable one is how merchants lose money.
   */
  allowsStacking?: boolean;
}

/** Why a coupon was rejected — the message is shown to the buyer. */
export type CouponRejectionReason =
  'not-found' | 'expired' | 'exhausted' | 'min-spend' | 'stacking-not-allowed';

export interface CouponValidationSuccess {
  ok: true;
  coupon: Coupon;
  /** What the code takes off `orderAmount`, as a decimal string. */
  discountAmount: string;
  /** `orderAmount - discountAmount`, as a decimal string. */
  finalAmount: string;
}

export interface CouponValidationFailure {
  ok: false;
  reason: CouponRejectionReason;
  message: string;
}

export type CouponValidationResult = CouponValidationSuccess | CouponValidationFailure;

/** Context for one validation attempt. */
export interface CouponValidationContext {
  /** Order total the code would apply to, as a decimal string. */
  orderAmount: string;
  /** Codes already applied to this order (excluding the one being validated). */
  appliedCodes?: string[];
  /** Injectable clock for tests. Defaults to `Date.now()`. */
  now?: number;
}

/**
 * Normalizes a typed code for lookup and comparison.
 *
 * Codes are case-insensitive and surrounding whitespace is not part of the
 * code — `  spring20 ` and `SPRING20` are the same code to a buyer, and
 * treating them as different would be a support ticket.
 */
export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Computes what a coupon takes off an order amount.
 *
 * Percent discounts are `amount * value / 100`; fixed discounts are the
 * flat value capped at the order amount (a $5 code cannot make a $3 order
 * negative). Both are floored to the stroop.
 *
 * @throws on a malformed amount or discount value.
 */
export function computeDiscountAmount(orderAmount: string, discount: Coupon['discount']): string {
  const amountStroops = toStroops(orderAmount);
  if (amountStroops === null || amountStroops < 0n) {
    throw new Error(`CouponService: invalid order amount '${orderAmount}'`);
  }

  if (discount.kind === 'fixed') {
    const fixedStroops = toStroops(discount.value);
    if (fixedStroops === null || fixedStroops < 0n) {
      throw new Error(`CouponService: invalid fixed discount '${discount.value}'`);
    }
    return fromStroops(fixedStroops < amountStroops ? fixedStroops : amountStroops);
  }

  const percentStroops = toStroops(discount.value);
  if (percentStroops === null || percentStroops < 0n) {
    throw new Error(`CouponService: invalid percent discount '${discount.value}'`);
  }
  // value is a percentage at 7 decimal places, so the divisor is
  // 100 * 10^7 to land back in the amount's stroops.
  const discountStroops = (amountStroops * percentStroops) / (100n * 10_000_000n);
  return fromStroops(discountStroops < amountStroops ? discountStroops : amountStroops);
}

/**
 * Validates a coupon against an order and, when valid, returns the discount
 * and the resulting final amount.
 *
 * Checks run in the order a buyer would want explained: existence, expiry,
 * redemption cap, minimum spend, then stacking. The first failure wins and
 * its message is buyer-facing.
 */
export function validateCoupon(
  coupon: Coupon | null,
  context: CouponValidationContext,
): CouponValidationResult {
  const now = context.now ?? Date.now();
  const applied = (context.appliedCodes ?? []).map(normalizeCouponCode);

  if (!coupon) {
    return { ok: false, reason: 'not-found', message: 'That code is not valid.' };
  }

  if (coupon.expiresAt) {
    const expiry = Date.parse(coupon.expiresAt);
    if (Number.isNaN(expiry)) {
      throw new Error(`CouponService: coupon '${coupon.code}' has an unparseable expiry`);
    }
    if (now >= expiry) {
      return { ok: false, reason: 'expired', message: 'This code has expired.' };
    }
  }

  if (coupon.maxRedemptions !== undefined && coupon.redeemedCount >= coupon.maxRedemptions) {
    return {
      ok: false,
      reason: 'exhausted',
      message: 'This code has reached its redemption limit.',
    };
  }

  if (coupon.minSpend !== undefined) {
    const minStroops = toStroops(coupon.minSpend);
    const amountStroops = toStroops(context.orderAmount);
    if (minStroops === null) {
      throw new Error(`CouponService: coupon '${coupon.code}' has an invalid minimum spend`);
    }
    if (amountStroops !== null && amountStroops < minStroops) {
      return {
        ok: false,
        reason: 'min-spend',
        message: `This code needs an order of at least ${coupon.minSpend}.`,
      };
    }
  }

  if (!coupon.allowsStacking && applied.length > 0) {
    return {
      ok: false,
      reason: 'stacking-not-allowed',
      message: 'This code cannot be combined with another code.',
    };
  }

  const discountAmount = computeDiscountAmount(context.orderAmount, coupon.discount);
  const finalStroops = (toStroops(context.orderAmount) ?? 0n) - (toStroops(discountAmount) ?? 0n);
  return {
    ok: true,
    coupon,
    discountAmount,
    finalAmount: fromStroops(finalStroops > 0n ? finalStroops : 0n),
  };
}

/** A line in the checkout price breakdown. */
export interface PriceBreakdownLine {
  label: string;
  /** Decimal string; negative for the discount row. */
  amount: string;
}

export interface PriceBreakdown {
  lines: PriceBreakdownLine[];
  /** The amount the authorization will be placed for, as a decimal string. */
  total: string;
}

/**
 * Builds the checkout price breakdown with the coupon as a savings line
 * item, so the discount is visible as its own row rather than folded into a
 * silently smaller total.
 */
export function priceBreakdown(
  orderAmount: string,
  result: CouponValidationSuccess,
): PriceBreakdown {
  const discountStroops = toStroops(result.discountAmount) ?? 0n;
  return {
    lines: [
      { label: 'Subtotal', amount: orderAmount },
      {
        label: `Coupon ${result.coupon.code}`,
        amount: fromStroops(-discountStroops),
      },
    ],
    total: result.finalAmount,
  };
}
