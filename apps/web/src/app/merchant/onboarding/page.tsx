'use client';

import Link from 'next/link';
import { useState } from 'react';
import { OnboardingStepper } from '@/components/onboarding/OnboardingStepper';
import { getDefaultAdapter } from '@/lib/wallet';

const STORAGE_KEY = 'accensa-merchant-onboarding';
const STEP_TITLES = [
  'Connect wallet',
  'Settlement preferences',
  'API keys and webhook',
  'Test checkout',
];

interface OnboardingProgress {
  completed: boolean[];
  activeStep: number;
  walletAddress: string;
  asset: 'USDC' | 'XLM';
  destination: string;
  webhookUrl: string;
}

const INITIAL_PROGRESS: OnboardingProgress = {
  completed: [false, false, false, false],
  activeStep: 0,
  walletAddress: '',
  asset: 'USDC',
  destination: '',
  webhookUrl: '',
};

function loadProgress(): OnboardingProgress {
  if (typeof window === 'undefined') return INITIAL_PROGRESS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...INITIAL_PROGRESS, ...JSON.parse(stored) } : INITIAL_PROGRESS;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return INITIAL_PROGRESS;
  }
}

export default function OnboardingPage() {
  const [progress, setProgress] = useState(loadProgress);
  const [walletState, setWalletState] = useState('');
  const [message, setMessage] = useState('');
  const [previewComplete, setPreviewComplete] = useState(false);

  function updateProgress(update: Partial<OnboardingProgress>) {
    setProgress((current) => {
      const next = { ...current, ...update };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function connectWallet() {
    setWalletState('Connecting…');
    const result = await getDefaultAdapter().connect();
    if (result.kind !== 'connected') {
      setWalletState('No wallet connection was completed.');
      return;
    }
    updateProgress({
      walletAddress: result.address,
      completed: [true, ...progress.completed.slice(1)],
    });
    setWalletState(`Connected: ${result.address}`);
  }

  async function saveWebhook() {
    if (progress.webhookUrl.trim()) {
      try {
        const response = await fetch('/api/merchant/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ webhookUrl: progress.webhookUrl.trim() }),
        });
        if (!response.ok) throw new Error('Webhook update was rejected');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Could not save webhook');
        return;
      }
    }
    updateProgress({ completed: [...progress.completed.slice(0, 2), true, progress.completed[3]] });
    setMessage('Setup details saved. API keys are managed in Settings.');
  }

  function completePreview() {
    setPreviewComplete(true);
    updateProgress({ completed: [...progress.completed.slice(0, 3), true] });
  }

  const finished = progress.completed.every(Boolean);
  const activeStep = finished ? 3 : progress.activeStep;

  return (
    <main className="min-h-screen bg-grid px-5 pb-16 pt-28 text-slate-800 dark:text-slate-100 md:px-10 md:pt-32">
      <section className="mx-auto max-w-5xl space-y-8">
        <header className="border-b border-slate-200 pb-6 dark:border-white/10">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
            Merchant setup
          </p>
          <h1 className="mt-2 text-3xl font-black text-slate-950 dark:text-white">
            Get Accensa ready
          </h1>
        </header>

        <OnboardingStepper
          steps={STEP_TITLES.map((title, index) => ({
            title,
            complete: progress.completed[index],
          }))}
          activeStep={activeStep}
          onSelect={(index) => updateProgress({ activeStep: index })}
        />

        {finished ? (
          <section
            className="relative overflow-hidden border-l-4 border-emerald-500 bg-emerald-50/80 p-6 dark:bg-emerald-500/10"
            aria-live="polite"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 flex justify-around"
            >
              {[
                'bg-emerald-500',
                'bg-amber-400',
                'bg-sky-500',
                'bg-rose-500',
                'bg-lime-500',
                'bg-orange-400',
              ].map((color, index) => (
                <span
                  key={color}
                  className={`onboarding-confetti ${color}`}
                  style={{ animationDelay: `${index * 90}ms` }}
                />
              ))}
            </div>
            <p className="text-sm font-bold uppercase tracking-widest text-emerald-800 dark:text-emerald-300">
              Setup complete
            </p>
            <h2 className="mt-2 text-2xl font-bold">Your merchant checklist is complete.</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Your checkout step was a local preview; it did not create a payment or receipt.
            </p>
          </section>
        ) : (
          <section className="max-w-3xl border border-slate-200 bg-white/60 p-6 dark:border-white/10 dark:bg-white/5 md:p-8">
            {activeStep === 0 && (
              <div className="space-y-5">
                <h2 className="text-xl font-bold">Connect your administrative wallet</h2>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Connect the Stellar wallet associated with this merchant account.
                </p>
                <button
                  type="button"
                  onClick={connectWallet}
                  className="bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-500"
                >
                  Connect Stellar wallet
                </button>
                {walletState && (
                  <p role="status" className="break-all text-sm">
                    {walletState}
                  </p>
                )}
              </div>
            )}

            {activeStep === 1 && (
              <div className="space-y-5">
                <h2 className="text-xl font-bold">Choose settlement preferences</h2>
                <label className="block text-sm font-semibold">
                  Settlement asset
                  <select
                    value={progress.asset}
                    onChange={(event) =>
                      updateProgress({ asset: event.target.value as 'USDC' | 'XLM' })
                    }
                    className="mt-2 block w-full border border-slate-300 bg-white p-3 dark:border-white/20 dark:bg-slate-900"
                  >
                    <option value="USDC">USDC</option>
                    <option value="XLM">XLM</option>
                  </select>
                </label>
                <label className="block text-sm font-semibold">
                  Destination Stellar account
                  <input
                    value={progress.destination}
                    onChange={(event) => updateProgress({ destination: event.target.value })}
                    placeholder="G…"
                    className="mt-2 block w-full border border-slate-300 bg-white p-3 font-mono text-sm dark:border-white/20 dark:bg-slate-900"
                  />
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Saved in this browser for this setup flow. Merchant payout destination settings
                  are not currently available in the account API.
                </p>
                <button
                  type="button"
                  disabled={!progress.destination.trim()}
                  onClick={() =>
                    updateProgress({
                      completed: [progress.completed[0], true, ...progress.completed.slice(2)],
                    })
                  }
                  className="bg-emerald-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                >
                  Save preferences
                </button>
              </div>
            )}

            {activeStep === 2 && (
              <div className="space-y-5">
                <h2 className="text-xl font-bold">Configure API access and notifications</h2>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Generate keys from your merchant settings, then optionally save a webhook
                  endpoint.
                </p>
                <Link
                  href="/merchant/settings/api-keys"
                  className="inline-flex border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-white/20"
                >
                  Open API key settings
                </Link>
                <label className="block text-sm font-semibold">
                  Webhook endpoint (optional)
                  <input
                    type="url"
                    value={progress.webhookUrl}
                    onChange={(event) => updateProgress({ webhookUrl: event.target.value })}
                    placeholder="https://merchant.example/webhooks/accensa"
                    className="mt-2 block w-full border border-slate-300 bg-white p-3 text-sm dark:border-white/20 dark:bg-slate-900"
                  />
                </label>
                <button
                  type="button"
                  onClick={saveWebhook}
                  className="bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-500"
                >
                  Save and continue
                </button>
                {message && (
                  <p role="status" className="text-sm">
                    {message}
                  </p>
                )}
              </div>
            )}

            {activeStep === 3 && (
              <div className="space-y-5">
                <h2 className="text-xl font-bold">Run the checkout preview</h2>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  This browser-only preview checks the setup flow. It does not contact a
                  facilitator, authorize funds, or create a receipt.
                </p>
                {previewComplete ? (
                  <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">
                    Preview complete.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={completePreview}
                    className="bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-500"
                  >
                    Run local checkout preview
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        <div className="flex justify-between">
          <button
            type="button"
            onClick={() => updateProgress({ activeStep: Math.max(0, activeStep - 1) })}
            disabled={activeStep === 0 || finished}
            className="border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-40 dark:border-white/20"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => updateProgress({ activeStep: Math.min(3, activeStep + 1) })}
            disabled={finished || activeStep === 3}
            className="border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-40 dark:border-white/20"
          >
            Continue
          </button>
        </div>
      </section>
    </main>
  );
}
