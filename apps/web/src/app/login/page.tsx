'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { signTransaction, readStatus, connect } from '@/lib/freighter';
import { PageContainer } from '@/components/page-container';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      // Ensure wallet is connected
      let status = await readStatus();
      if (status.kind === 'unavailable') {
        throw new Error('Stellar wallet not found. Please install Freighter.');
      }
      if (status.kind !== 'connected') {
        status = await connect();
        if (status.kind !== 'connected') {
          throw new Error(status.kind === 'error' ? status.message : 'Could not connect wallet.');
        }
      }

      // Fetch challenge
      const res = await fetch('/api/auth/challenge');
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error || 'Failed to fetch auth challenge');
      }
      const { xdr, networkPassphrase } = await res.json();

      // Sign challenge
      const signedXdr = await signTransaction(xdr, { networkPassphrase, address: status.address });

      // Verify signature
      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xdr: signedXdr }),
      });

      if (!verifyRes.ok) {
        const { error } = await verifyRes.json();
        throw new Error(error || 'Verification failed');
      }

      router.push('/dashboard');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen text-slate-600 dark:text-slate-200 font-sans selection:bg-slate-200 dark:selection:bg-white/10 transition-colors duration-300 bg-grid p-6 md:p-12 lg:p-20 pt-28 md:pt-32 lg:pt-32 flex items-center justify-center">
      <PageContainer width="narrow" className="w-full max-w-md space-y-8">
        <header className="space-y-4 text-center">
          <p className="uppercase tracking-[0.25em] text-emerald-600 dark:text-emerald-400 font-bold text-xs">
            Merchant Access
          </p>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tighter text-slate-900 dark:text-white transition-colors duration-300">
            Merchant Login
          </h1>
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-sm transition-colors duration-300">
            Authenticate with your Stellar wallet to access the Accensa dashboard.
          </p>
        </header>

        <div className="bg-white/50 dark:bg-white/5 backdrop-blur-2xl p-8 space-y-6 shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] relative overflow-hidden transition-colors duration-300">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 blur-[40px] dark:blur-[50px] pointer-events-none" />

          <div className="flex justify-center">
            <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
              <ShieldAlert className="w-8 h-8" />
            </div>
          </div>

          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-[#0a111a] p-4 flex gap-3 items-start text-sm text-red-600 dark:text-red-400 transition-colors duration-300"
            >
              <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-500" />
              <p>{error}</p>
            </div>
          )}

          <button
            type="button"
            onClick={handleLogin}
            disabled={loading}
            aria-busy={loading}
            className="w-full flex items-center justify-center gap-2 px-8 py-4 bg-emerald-600 dark:bg-emerald-500 text-white dark:text-black font-black text-sm uppercase tracking-wider hover:bg-emerald-500 dark:hover:bg-emerald-400 disabled:opacity-50 transition-all shadow-md shadow-emerald-600/20 dark:shadow-[0_0_20px_rgba(16,185,129,0.2)] cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Connecting...</span>
              </>
            ) : (
              'Connect Wallet'
            )}
          </button>
        </div>
      </PageContainer>
    </main>
  );
}
