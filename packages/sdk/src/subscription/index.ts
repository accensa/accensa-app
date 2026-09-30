/**
 * Recurring payment / subscription plan management (#427).
 *
 * A merchant defines a {@link SubscriptionPlan} (billing interval, trial and
 * grace windows); a customer's {@link Subscription} tracks where one
 * particular customer is against that plan. The state machine here is pure
 * and storage-agnostic — the merchant dashboard and the customer portal both
 * drive it, and a scheduled job (or the payment webhook) calls
 * `applyChargeResult` / `advancePeriod` when a recurring authorization
 * settles, so persistence and Stellar payment authorization plumbing stay
 * out of this module.
 */

export type BillingInterval = 'weekly' | 'monthly' | 'annual';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';

export interface SubscriptionPlan {
  id: string;
  merchantId: string;
  name: string;
  /** Amount charged per billing period, as a decimal string. */
  amount: string;
  /** Stellar Asset Contract id or asset code the plan bills in. */
  asset: string;
  billingInterval: BillingInterval;
  /** Days of free trial before the first charge; 0 disables the trial. */
  trialDays: number;
  /** Days a `past_due` subscription is kept active before it expires. */
  graceDays: number;
  createdAt: string;
}

export interface Subscription {
  id: string;
  planId: string;
  /** Stellar address of the paying customer. */
  customerAddress: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  /** When the current period's access ends, and the next charge is due. */
  currentPeriodEnd: string;
  /** Set once a `past_due` subscription enters its grace window. */
  graceEndsAt: string | null;
  /** Customer requested cancellation; access continues until `currentPeriodEnd`. */
  cancelAtPeriodEnd: boolean;
  createdAt: string;
}

export interface CreateSubscriptionPlanInput {
  merchantId: string;
  name: string;
  amount: string;
  asset: string;
  billingInterval: BillingInterval;
  trialDays?: number;
  graceDays?: number;
}

const DECIMAL_AMOUNT = /^\d+(\.\d{1,7})?$/;

/** Builds a validated {@link SubscriptionPlan}; throws on a malformed amount. */
export function createSubscriptionPlan(
  input: CreateSubscriptionPlanInput,
  id: string,
  now: Date = new Date(),
): SubscriptionPlan {
  if (!DECIMAL_AMOUNT.test(input.amount) || Number(input.amount) <= 0) {
    throw new Error('amount must be a positive decimal string');
  }
  if (!input.name.trim()) {
    throw new Error('name is required');
  }
  return {
    id,
    merchantId: input.merchantId,
    name: input.name.trim(),
    amount: input.amount,
    asset: input.asset,
    billingInterval: input.billingInterval,
    trialDays: Math.max(0, input.trialDays ?? 0),
    graceDays: Math.max(0, input.graceDays ?? 3),
    createdAt: now.toISOString(),
  };
}

/** Advances `from` by one billing period. */
export function nextBillingDate(interval: BillingInterval, from: Date): Date {
  const next = new Date(from);
  switch (interval) {
    case 'weekly':
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case 'monthly':
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    case 'annual':
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
  }
  return next;
}

/** Starts a customer on a plan — trialing first if the plan offers one. */
export function startSubscription(
  plan: SubscriptionPlan,
  customerAddress: string,
  id: string,
  now: Date = new Date(),
): Subscription {
  const periodEnd =
    plan.trialDays > 0
      ? new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000)
      : nextBillingDate(plan.billingInterval, now);

  return {
    id,
    planId: plan.id,
    customerAddress,
    status: plan.trialDays > 0 ? 'trialing' : 'active',
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: periodEnd.toISOString(),
    graceEndsAt: null,
    cancelAtPeriodEnd: false,
    createdAt: now.toISOString(),
  };
}

/**
 * Advances a subscription whose period has ended: renews it (unless the
 * customer asked to cancel) or moves a `canceled` subscription to `expired`.
 * Call this from the scheduled renewal job, before attempting a charge.
 */
export function advancePeriod(
  subscription: Subscription,
  plan: SubscriptionPlan,
  now: Date = new Date(),
): Subscription {
  if (new Date(subscription.currentPeriodEnd) > now) return subscription;

  if (subscription.cancelAtPeriodEnd || subscription.status === 'canceled') {
    return { ...subscription, status: 'expired' };
  }

  return {
    ...subscription,
    status: 'active',
    currentPeriodStart: subscription.currentPeriodEnd,
    currentPeriodEnd: nextBillingDate(
      plan.billingInterval,
      new Date(subscription.currentPeriodEnd),
    ).toISOString(),
    graceEndsAt: null,
  };
}

/** Records the outcome of a recurring-authorization charge attempt. */
export function applyChargeResult(
  subscription: Subscription,
  plan: SubscriptionPlan,
  succeeded: boolean,
  now: Date = new Date(),
): Subscription {
  if (succeeded) {
    return { ...subscription, status: 'active', graceEndsAt: null };
  }
  const graceEndsAt = new Date(now.getTime() + plan.graceDays * 24 * 60 * 60 * 1000).toISOString();
  return { ...subscription, status: 'past_due', graceEndsAt };
}

/** Expires a `past_due` subscription once its grace window has elapsed. */
export function expireIfGraceElapsed(
  subscription: Subscription,
  now: Date = new Date(),
): Subscription {
  if (subscription.status !== 'past_due' || !subscription.graceEndsAt) return subscription;
  if (new Date(subscription.graceEndsAt) > now) return subscription;
  return { ...subscription, status: 'expired' };
}

/** Customer-initiated cancellation: access continues until the period ends. */
export function cancelAtPeriodEnd(subscription: Subscription): Subscription {
  if (subscription.status === 'canceled' || subscription.status === 'expired') return subscription;
  return { ...subscription, cancelAtPeriodEnd: true };
}

/** Reverses a pending cancellation while the subscription is still active. */
export function reactivate(subscription: Subscription): Subscription {
  if (subscription.status === 'canceled' || subscription.status === 'expired') {
    throw new Error('cannot reactivate a subscription that has already ended');
  }
  return { ...subscription, cancelAtPeriodEnd: false };
}

/** Immediately cancels a subscription, ending access now rather than at period end. */
export function cancelImmediately(
  subscription: Subscription,
  now: Date = new Date(),
): Subscription {
  return {
    ...subscription,
    status: 'canceled',
    cancelAtPeriodEnd: true,
    currentPeriodEnd: now.toISOString(),
  };
}
