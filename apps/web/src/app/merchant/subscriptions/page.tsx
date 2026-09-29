'use client';

import React, { useState } from 'react';
import {
  cancelAtPeriodEnd,
  createSubscriptionPlan,
  reactivate,
  startSubscription,
  type BillingInterval,
  type Subscription,
  type SubscriptionPlan,
} from '@accensa/sdk/subscription';
import SubscriptionCard from '../../../../components/subscriptions/SubscriptionCard';

interface PlanFormState {
  name: string;
  amount: string;
  asset: string;
  billingInterval: BillingInterval;
  trialDays: string;
  graceDays: string;
}

const EMPTY_FORM: PlanFormState = {
  name: '',
  amount: '',
  asset: 'USDC',
  billingInterval: 'monthly',
  trialDays: '0',
  graceDays: '3',
};

const MERCHANT_ID = 'current-merchant'; // TODO: read from the auth/session context.

/**
 * Merchant subscription plan management (#427): define tiers and billing
 * intervals, and preview how a subscriber's card renders and cancels.
 *
 * Plans are held in page state, which is enough to exercise the SDK's
 * subscription state machine end to end; wiring plan persistence to
 * `/api/merchant/subscriptions` is a follow-up once that route exists.
 */
export default function MerchantSubscriptionsPage() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [form, setForm] = useState<PlanFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const handleCreatePlan = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    try {
      const plan = createSubscriptionPlan(
        {
          merchantId: MERCHANT_ID,
          name: form.name,
          amount: form.amount,
          asset: form.asset,
          billingInterval: form.billingInterval,
          trialDays: Number.parseInt(form.trialDays, 10) || 0,
          graceDays: Number.parseInt(form.graceDays, 10) || 0,
        },
        `plan-${crypto.randomUUID()}`,
      );
      setPlans((prev) => [...prev, plan]);
      // A sample subscriber preview, so the merchant sees how the plan renders.
      setSubscriptions((prev) => [
        ...prev,
        startSubscription(plan, 'GSAMPLECUSTOMER', `sub-${plan.id}`),
      ]);
      setForm(EMPTY_FORM);
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : 'Could not create the plan');
    }
  };

  const toggleCancel = (subscriptionId: string, nextCancelAtPeriodEnd: boolean) => {
    setSubscriptions((prev) =>
      prev.map((sub) =>
        sub.id === subscriptionId
          ? nextCancelAtPeriodEnd
            ? cancelAtPeriodEnd(sub)
            : reactivate(sub)
          : sub,
      ),
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Subscription plans</h1>
        <p className="text-sm text-gray-500">
          Define recurring billing tiers for customers to subscribe to at checkout.
        </p>
      </div>

      <form onSubmit={handleCreatePlan} className="space-y-4 rounded-lg border border-gray-200 p-4">
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm">
            <span className="text-gray-700">Plan name</span>
            <input
              type="text"
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">Amount</span>
            <input
              type="text"
              required
              placeholder="10.0000000"
              value={form.amount}
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">Asset</span>
            <input
              type="text"
              required
              value={form.asset}
              onChange={(event) => setForm({ ...form, asset: event.target.value })}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">Billing interval</span>
            <select
              value={form.billingInterval}
              onChange={(event) =>
                setForm({ ...form, billingInterval: event.target.value as BillingInterval })
              }
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">Trial days</span>
            <input
              type="number"
              min="0"
              value={form.trialDays}
              onChange={(event) => setForm({ ...form, trialDays: event.target.value })}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">Grace period (days)</span>
            <input
              type="number"
              min="0"
              value={form.graceDays}
              onChange={(event) => setForm({ ...form, graceDays: event.target.value })}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
        </div>

        {formError && (
          <p className="text-sm text-red-600" role="alert">
            {formError}
          </p>
        )}

        <button
          type="submit"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Create plan
        </button>
      </form>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Plans</h2>
        {plans.length === 0 && <p className="text-sm text-gray-500">No plans yet.</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {plans.map((plan) => {
            const subscription = subscriptions.find((sub) => sub.planId === plan.id);
            if (!subscription) return null;
            return (
              <SubscriptionCard
                key={plan.id}
                plan={plan}
                subscription={subscription}
                onToggleCancel={(next) => toggleCancel(subscription.id, next)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
