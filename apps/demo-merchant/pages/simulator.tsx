import Link from 'next/link';
import ChannelSimulator from '../components/ChannelSimulator';

export default function SimulatorPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">
              Accensa / Demo merchant
            </p>
            <h1 className="mt-1 text-xl font-semibold">State channel simulator</h1>
          </div>
          <Link
            className="text-sm font-medium text-slate-600 underline underline-offset-4 hover:text-slate-950"
            href="/"
          >
            Back to store
          </Link>
        </div>
      </header>
      <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-center text-sm text-amber-950">
        Educational simulation only. No testnet or mainnet transactions are submitted.
      </div>
      <div className="mx-auto max-w-6xl px-5 py-8">
        <div className="mb-6 max-w-2xl">
          <p className="text-sm leading-relaxed text-slate-600">
            Adjust the off-chain balance to create new signed states. Each state is signed by
            ephemeral merchant and customer Ed25519 keys in this browser.
          </p>
        </div>
        <ChannelSimulator />
      </div>
    </main>
  );
}
