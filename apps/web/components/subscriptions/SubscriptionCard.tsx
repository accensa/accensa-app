'use client';

import React from 'react';
import type { Subscription, SubscriptionPlan } from '@accensa/sdk/subscription';

export interface SubscriptionCardProps {
  subscription: Subscription;
  plan: SubscriptionPlan;
  /** Omit to render a read-only card, e.g. in a merchant's subscriber list. */
  onToggleCancel?: (nextCancelAtPeriodEnd: boolean) => void | Promise<void>;
}

const STATUS_LABEL: Record<Subscription['status'], string> = {
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  canceled: 'Canceled',
  expired: 'Expired',
};

const STATUS_STYLE: Record<Subscription['status'], string> = {
  trialing: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  past_due: 'bg-amber-100 text-amber-700',
  canceled: 'bg-gray-100 text-gray-600',
  expired: 'bg-gray-100 text-gray-500',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * A single customer's subscription against a merchant's plan (#427). Used in
 * both the customer portal (with `onToggleCancel`) and a merchant's
 * subscriber list (read-only, `onToggleCancel` omitted).
 */
export default function SubscriptionCard({
  subscription,
  plan,
  onToggleCancel,
}: SubscriptionCardProps) {
  const hasEnded = subscription.status === 'canceled' || subscription.status === 'expired';
  const canToggle = !hasEnded && !!onToggleCancel;

  return (
    <div className="rounded-lg border border-gray-200 p-4" data-testid="subscription-card">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">{plan.name}</h4>
          <p className="text-xs text-gray-500">
            {plan.amount} {plan.asset} / {plan.billingInterval}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLE[subscription.status]}`}
          data-testid="subscription-status"
        >
          {STATUS_LABEL[subscription.status]}
        </span>
      </div>

      <dl className="mt-3 text-sm text-gray-600">
        <div className="flex justify-between">
          <dt>{hasEnded ? 'Ended' : 'Next billing date'}</dt>
          <dd data-testid="subscription-next-billing">
            {formatDate(subscription.currentPeriodEnd)}
          </dd>
        </div>
      </dl>

      {subscription.cancelAtPeriodEnd && !hasEnded && (
        <p className="mt-2 text-xs text-amber-600">Cancels at the end of the current period.</p>
      )}

      {canToggle && (
        <button
          type="button"
          onClick={() => onToggleCancel?.(!subscription.cancelAtPeriodEnd)}
          className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {subscription.cancelAtPeriodEnd ? 'Keep subscription' : 'Cancel subscription'}
        </button>
      )}
    </div>
  );
}
