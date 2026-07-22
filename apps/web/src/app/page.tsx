import React from 'react';
import Link from 'next/link';
import { RECEIPT_ANCHOR_ID } from '@/lib/receipt-anchor';

const REFUND_VAULT_ID =
  process.env.NEXT_PUBLIC_REFUND_VAULT_ID ??
  'CCMBM44EJUGD52G4LSMGHSXMAH2KSAQZX7VOYY4TTBF5BK4D7M4IHRQA';

const explorer = (id: string) =>
  `https://stellar.expert/explorer/testnet/contract/${id}`;

export default function Landing() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="fixed inset-0 overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-15%] left-[-10%] w-[45%] h-[45%] rounded-full bg-emerald-600/20 blur-[140px]" />
        <div className="absolute bottom-[-15%] right-[-10%] w-[45%] h-[45%] rounded-full bg-teal-600/20 blur-[140px]" />
      </div>

      <Nav />

      {/* Hero */}
      <section className="px-6 pt-20 pb-24 md:pt-32 md:pb-32">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <p className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 text-emerald-300 text-xs font-medium">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
            </span>
            Live on Stellar testnet
          </p>

          <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-[1.05]">
            Prove every{' '}
            <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
              x402 payment
            </span>
            .
          </h1>

          <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
            Agents prove they were charged correctly. Merchants refund without
            becoming custodians. Receipts anchored on Stellar, verifiable by
            anyone — no account required.
          </p>

          <div className="flex flex-wrap gap-3 justify-center pt-2">
            <Link
              href="/verify"
              className="px-6 py-3 rounded-lg bg-emerald-500 text-black font-semibold text-sm hover:bg-emerald-400 transition-colors"
            >
              Verify a receipt
            </Link>
            <Link
              href="/dashboard"
              className="px-6 py-3 rounded-lg border border-white/15 text-gray-200 font-medium text-sm hover:bg-white/5 transition-colors"
            >
              View the dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* Problem */}
      <Section title="The problem">
        <p className="text-gray-400 leading-relaxed">
          x402 turns any HTTP endpoint into a paid resource: an agent hits your
          API, gets a <code className="text-emerald-300">402 Payment Required</code>,
          pays, and retries. That works — but it leaves both sides without
          recourse.
        </p>
        <div className="grid md:grid-cols-2 gap-4 pt-2">
          <Card title="The agent cannot audit">
            Its receipt comes from the seller&rsquo;s own API, attesting to the
            seller&rsquo;s own behaviour. When an agent makes thousands of
            sub-cent calls a day across dozens of vendors, &ldquo;trust the
            seller&rsquo;s dashboard&rdquo; is not an auditing story.
          </Card>
          <Card title="The merchant cannot refund safely">
            Manual refunds don&rsquo;t scale to per-request payments, and an
            unbounded refund key over merchant float is exactly what a seller
            does not want sitting in a web backend.
          </Card>
        </div>
      </Section>

      {/* How it works */}
      <Section title="How it works">
        <ol className="grid md:grid-cols-3 gap-4">
          <Step n={1} title="Agent pays">
            Payment settles on Stellar as a Stellar Asset Contract transfer.
          </Step>
          <Step n={2} title="Accensa indexes and anchors">
            The indexer decodes transfers to your address, then anchors a Merkle
            root of the batch on-chain.
          </Step>
          <Step n={3} title="Anyone verifies">
            An agent checks its receipt against the anchored root — locally and
            against the contract. No account, no trust in us.
          </Step>
        </ol>
      </Section>

      {/* Live proof */}
      <Section title="Live, not a mockup">
        <p className="text-gray-400 leading-relaxed">
          Both contracts are deployed and initialized on Stellar testnet, and
          batch #1 is anchored. You can verify a receipt against it right now —
          and watch a forged one get rejected.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 pt-2">
          <ContractCard name="ReceiptAnchor" id={RECEIPT_ANCHOR_ID} />
          <ContractCard name="RefundVault" id={REFUND_VAULT_ID} />
        </div>
        <Link
          href="/verify"
          className="inline-block text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          Try the verifier with a sample receipt →
        </Link>
      </Section>

      {/* Two audiences */}
      <Section title="Two sides, one ledger">
        <div className="grid md:grid-cols-2 gap-4">
          <Card title="For merchants">
            See revenue reconstructed from chain data, attributed to the endpoint
            that earned it, with refunds bounded by an on-chain policy instead of
            a support inbox.
            <Link
              href="/dashboard"
              className="block pt-3 text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              Open the dashboard →
            </Link>
          </Card>
          <Card title="For agent operators">
            Verify any receipt you were given, against the ledger, without an
            account or a wallet. If the proof doesn&rsquo;t lead to the anchored
            root, you know — and so does everyone else.
            <Link
              href="/verify"
              className="block pt-3 text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              Verify a receipt →
            </Link>
          </Card>
        </div>
      </Section>

      {/* Why Stellar */}
      <Section title="Why Stellar">
        <ul className="space-y-3 text-gray-400 leading-relaxed">
          <Bullet label="Sub-cent fees">
            make per-request agent payments viable at all. On most chains the
            settlement fee exceeds the payment.
          </Bullet>
          <Bullet label="Batched anchoring">
            amortises to near zero — one call covers an entire billing period, so
            verifiability costs a fraction of a cent per receipt.
          </Bullet>
          <Bullet label="Native USDC">
            means float and refunds settle in the asset merchants actually price
            in, with no bridge.
          </Bullet>
          <Bullet label="Predictable fees">
            let a merchant bound the cost of their refund policy in advance
            rather than guessing at gas.
          </Bullet>
        </ul>
      </Section>

      {/* Get started */}
      <Section title="Verify a receipt in your own code">
        <p className="text-gray-400 leading-relaxed">
          The SDK mirrors the contract exactly — sorted-pair SHA-256, so proofs
          carry no position flags. Both implementations are pinned to the same
          conformance vectors.
        </p>
        <pre className="mt-2 overflow-x-auto rounded-xl border border-white/10 bg-black/50 p-5 text-sm">
          <code className="text-gray-300">{`import { verifyReceipt } from '@accensa/sdk/merkle';

const ok = verifyReceipt(receiptHash, proof, anchoredRoot);
if (!ok) throw new Error('Receipt is not in the anchored batch');`}</code>
        </pre>
      </Section>

      <footer className="px-6 py-12 border-t border-white/5">
        <div className="max-w-4xl mx-auto flex flex-wrap gap-x-6 gap-y-2 justify-center text-sm text-gray-500">
          <Link href="/dashboard" className="hover:text-gray-300 transition-colors">
            Dashboard
          </Link>
          <Link href="/verify" className="hover:text-gray-300 transition-colors">
            Verify
          </Link>
          <a
            href="https://accensa-docs.vercel.app"
            className="hover:text-gray-300 transition-colors"
          >
            Documentation
          </a>
          <a
            href="https://github.com/accensa"
            className="hover:text-gray-300 transition-colors"
          >
            GitHub
          </a>
        </div>
      </footer>
    </main>
  );
}

function Nav() {
  return (
    <nav className="px-6 py-5 border-b border-white/5">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        <span className="text-lg font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
          Accensa
        </span>
        <div className="flex items-center gap-5 text-sm text-gray-400">
          <Link href="/verify" className="hover:text-white transition-colors">
            Verify
          </Link>
          <Link href="/dashboard" className="hover:text-white transition-colors">
            Dashboard
          </Link>
          <a
            href="https://github.com/accensa"
            className="hover:text-white transition-colors"
          >
            GitHub
          </a>
        </div>
      </div>
    </nav>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-6 py-14 border-t border-white/5">
      <div className="max-w-4xl mx-auto space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {children}
      </div>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-2">
      <p className="font-medium text-gray-200">{title}</p>
      <div className="text-sm text-gray-400 leading-relaxed">{children}</div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-2">
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500/15 text-emerald-300 text-sm font-semibold">
        {n}
      </span>
      <p className="font-medium text-gray-200">{title}</p>
      <p className="text-sm text-gray-400 leading-relaxed">{children}</p>
    </li>
  );
}

function ContractCard({ name, id }: { name: string; id: string }) {
  return (
    <a
      href={explorer(id)}
      target="_blank"
      rel="noreferrer"
      className="block rounded-2xl border border-white/10 bg-white/[0.03] p-5 hover:border-emerald-500/30 transition-colors group"
    >
      <p className="text-sm font-medium text-gray-200 group-hover:text-emerald-300 transition-colors">
        {name} ↗
      </p>
      <p className="font-mono text-xs text-gray-500 break-all mt-1">{id}</p>
    </a>
  );
}

function Bullet({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="text-emerald-400 shrink-0">—</span>
      <span>
        <strong className="text-gray-200 font-medium">{label}</strong> {children}
      </span>
    </li>
  );
}
