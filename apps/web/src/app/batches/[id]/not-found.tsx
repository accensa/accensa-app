import Link from 'next/link';

export default function BatchNotFound() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white px-6 py-24 flex items-center">
      <div className="max-w-xl mx-auto text-center space-y-5">
        <h1 className="text-3xl font-bold tracking-tight">Batch not found</h1>
        <p className="text-gray-400 leading-relaxed">
          No batch with that ID has been anchored on this contract. Batch IDs are
          sequential and start at 1 — check the number, or verify a receipt
          directly if you have its proof.
        </p>
        <div className="flex flex-wrap gap-3 justify-center pt-2">
          <Link
            href="/verify"
            className="px-5 py-2.5 rounded-lg bg-emerald-500 text-black font-semibold text-sm hover:bg-emerald-400 transition-colors"
          >
            Verify a receipt
          </Link>
          <Link
            href="/"
            className="px-5 py-2.5 rounded-lg border border-white/15 text-gray-200 text-sm hover:bg-white/5 transition-colors"
          >
            Back to Accensa
          </Link>
        </div>
      </div>
    </main>
  );
}
