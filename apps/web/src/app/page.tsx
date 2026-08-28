import React from 'react';
import { ScrollReveal } from '@/components/scroll-reveal';
import { FaqAccordion } from '@/components/faq-accordion';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { RECEIPT_ANCHOR_ID } from '@/lib/receipt-anchor';
import { explorerContractUrl } from '@/lib/explorer';
import { PageContainer } from '@/components/page-container';
import { SectionHeading } from '@/components/section-heading';
import { CtaButton } from '@/components/cta-button';

const REFUND_VAULT_ID =
  process.env.NEXT_PUBLIC_REFUND_VAULT_ID ??
  'CCMBM44EJUGD52G4LSMGHSXMAH2KSAQZX7VOYY4TTBF5BK4D7M4IHRQA';

const faqItems = [
  {
    question: 'What is Accensa?',
    answer:
      'Accensa is a decentralized protocol that enables trustless, verifiable micro-payments for AI agents. It ensures that agents are only charged for what they use by anchoring receipts on the Stellar network.',
  },
  {
    question: 'What exactly does Accensa solve?',
    answer:
      'AI agents need to pay for resources, but current systems either require trusting a custodian or have transaction fees that exceed the micro-payments themselves. Accensa enables trustless, verifiable micro-payments using Stellar.',
  },
  {
    question: 'Do I need to hold XLM to use this?',
    answer:
      "No, payments settle natively in USDC. You only need a tiny amount of XLM to cover Stellar's sub-cent network fees, which can often be sponsored by the application.",
  },
  {
    question: 'How are receipts verified?',
    answer:
      'Receipts are batched and anchored to the Stellar network using Merkle trees. Anyone can independently verify that their receipt was included in the anchored root without trusting the merchant.',
  },
  {
    question: 'Is this ready for mainnet?',
    answer:
      'Currently, both contracts are deployed and initialized on the Stellar testnet for developers to integrate and test safely.',
  },
];

export default function Landing() {
  return (
    <main className="min-h-screen text-slate-600 dark:text-slate-200 font-sans selection:bg-slate-200 dark:selection:bg-white/10 transition-colors duration-300 bg-grid">
      {/* Hero Section */}
      <section className="relative px-6 pt-32 pb-12 md:pt-44 md:pb-16 overflow-hidden flex flex-col items-center justify-center min-h-[80vh]">
        <div className="absolute inset-0 bg-noise opacity-10 dark:opacity-20 pointer-events-none mix-blend-overlay z-0" />
        {/* Subtle radial glow matching emerald theme */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-transparent dark:bg-emerald-500/5 blur-[100px] dark:blur-[120px] pointer-events-none transition-colors duration-300" />

        <PageContainer className="text-center space-y-8 relative z-10">
          <div className="inline-flex items-center mb-4 transition-colors duration-300">
            <span className="text-sm font-camiro font-bold tracking-[0.35em] text-emerald-600 dark:text-emerald-400 uppercase">
              — Live on Stellar Testnet —
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-harabara font-bold tracking-wide leading-[1.05] text-slate-900 dark:text-white transition-colors duration-300">
            <span className="block">Trustless payments,</span>
            <span className="block text-slate-400 dark:text-slate-500 italic font-normal">
              for AI agents.
            </span>
          </h1>

          <p className="text-lg md:text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed font-medium transition-colors duration-300">
            Agents cryptographically prove they were charged correctly. Merchants refund without
            custodian risk. Verifiable by anyone, anchored on Stellar.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-8">
            <CtaButton href="/verify">Verify a Receipt</CtaButton>
            <CtaButton href="/dashboard" variant="secondary">
              View Dashboard
            </CtaButton>
          </div>
        </PageContainer>
      </section>

      {/* Bento Grid Architecture */}
      <ScrollReveal as="section" className="px-6 py-12 md:py-16 relative">
        <PageContainer>
          <SectionHeading eyebrow="Architecture" tail="works." className="mb-12 text-center">
            How it
          </SectionHeading>

          <div className="grid md:grid-cols-3 gap-6">
            <BentoCard
              className="md:col-span-2 transition-all duration-300"
              title="1. The Agent Pays"
            >
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed font-medium mt-2 transition-colors duration-300">
                Every request acts as an isolated transaction. The payment settles natively on
                Stellar as a Stellar Asset Contract transfer, leaving an immutable footprint.
              </p>
            </BentoCard>
            <BentoCard className="md:row-span-2" title="2. Facilitator Processes">
              <div className="space-y-4 mt-4">
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed font-medium transition-colors duration-300">
                  The facilitator handles x402 payments to your address in real-time, allowing
                  Accensa to group them into cryptographically secure batches.
                </p>
                <div className="p-4 bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/5 font-mono text-xs text-emerald-600 dark:text-emerald-400 break-all transition-colors duration-300">
                  root: 7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1
                </div>
              </div>
            </BentoCard>
            <BentoCard className="md:col-span-2" title="3. Anyone Verifies">
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed font-medium mt-2 transition-colors duration-300">
                Agents check their receipt against the anchored root - locally and directly against
                the smart contract. Zero trust required.
              </p>
              <div className="mt-8">
                <Link
                  href="/verify"
                  className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-300 transition-colors"
                >
                  Try the Verifier →
                </Link>
              </div>
            </BentoCard>
          </div>
        </PageContainer>
      </ScrollReveal>

      {/* The Protocol Benefits */}
      <ScrollReveal as="section" className="px-6 py-12 md:py-16 transition-colors duration-300">
        <PageContainer>
          <div className="flex flex-col md:flex-row justify-between items-center md:items-end gap-6 md:gap-10 mb-12 text-center md:text-left">
            <SectionHeading eyebrow="Protocol" tail="Stellar?" className="max-w-2xl">
              Why
            </SectionHeading>
            <p className="text-slate-600 dark:text-slate-400 font-medium max-w-md text-lg transition-colors duration-300">
              Built on a ledger designed specifically for high-throughput, low-latency financial
              settlement.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <FeatureCard
              title="Sub-cent Fees"
              desc="Make per-request agent payments viable at all. On most chains the settlement fee exceeds the payment."
            />
            <FeatureCard
              title="Batched Anchoring"
              desc="Amortizes to near zero - one call covers an entire billing period. Verifiability costs a fraction of a cent."
            />
            <FeatureCard
              title="Native USDC"
              desc="Means float and refunds settle in the asset merchants actually price in, with absolutely no bridging."
            />
            <FeatureCard
              title="Predictable Gas"
              desc="Lets a merchant definitively bound the cost of their refund policy in advance rather than guessing."
            />
          </div>
        </PageContainer>
      </ScrollReveal>

      {/* Contracts Live */}
      <ScrollReveal as="section" className="px-6 py-12 md:py-16 transition-colors duration-300">
        <PageContainer>
          <div className="text-center mb-12">
            <SectionHeading eyebrow="Network" tail="Contracts.">
              Live
            </SectionHeading>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed mt-6 text-lg font-medium max-w-2xl mx-auto transition-colors duration-300">
              Both contracts are deployed and initialized on Stellar testnet, and batch #1 is
              anchored. Verify receipts against it right now.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-6">
            <ContractCard name="ReceiptAnchor" id={RECEIPT_ANCHOR_ID} />
            <ContractCard name="RefundVault" id={REFUND_VAULT_ID} />
          </div>
        </PageContainer>
      </ScrollReveal>

      {/* Integration Code block */}
      <ScrollReveal as="section" className="px-6 py-12 md:py-16 transition-colors duration-300">
        <PageContainer>
          <SectionHeading
            eyebrow="Integration"
            tail="Drop-in."
            className="mb-10 text-center md:text-left"
          >
            SDK
          </SectionHeading>
          <div className="bg-white/40 dark:bg-black/20 backdrop-blur-2xl overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] relative group transition-colors duration-300">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-teal-400 opacity-80 dark:opacity-50" />
            <div className="px-6 py-4 border-b border-slate-200/50 dark:border-white/10 flex gap-2 transition-colors duration-300 bg-white/20 dark:bg-white/5">
              <div className="w-3 h-3 bg-slate-300 dark:bg-white/20" />
              <div className="w-3 h-3 bg-slate-300 dark:bg-white/20" />
              <div className="w-3 h-3 bg-slate-300 dark:bg-white/20" />
            </div>
            <pre className="p-4 md:p-8 overflow-x-auto text-xs md:text-sm">
              <code className="block text-slate-700 dark:text-slate-300 font-mono leading-loose transition-colors duration-300 whitespace-pre-wrap break-words md:whitespace-pre md:break-normal">
                <span className="text-emerald-600 dark:text-emerald-400 font-bold dark:font-normal">
                  import
                </span>{' '}
                {'{ verifyReceipt }'}{' '}
                <span className="text-emerald-600 dark:text-emerald-400 font-bold dark:font-normal">
                  from
                </span>{' '}
                &apos;@accensa/sdk/merkle&apos;;
                <br />
                <br />
                <span className="text-slate-400 dark:text-slate-500 italic dark:not-italic">
                  {'// Verify locally or on-chain'}
                </span>
                <br />
                <span className="text-emerald-600 dark:text-emerald-400 font-bold dark:font-normal">
                  const
                </span>{' '}
                ok = verifyReceipt(receiptHash, proof, anchoredRoot);
                <br />
                <span className="text-emerald-600 dark:text-emerald-400 font-bold dark:font-normal">
                  if
                </span>{' '}
                (!ok){' '}
                <span className="text-emerald-600 dark:text-emerald-400 font-bold dark:font-normal">
                  throw new
                </span>{' '}
                Error(&apos;Receipt is not in the anchored batch&apos;);
              </code>
            </pre>
          </div>
        </PageContainer>
      </ScrollReveal>

      {/* FAQ Section */}
      <ScrollReveal as="section" className="px-6 py-12 md:py-16 transition-colors duration-300">
        <PageContainer>
          <SectionHeading
            eyebrow="FAQ"
            tail="Questions."
            className="mb-12 text-center md:text-left"
          >
            Common
          </SectionHeading>
          <FaqAccordion items={faqItems} />
        </PageContainer>
      </ScrollReveal>
    </main>
  );
}

function BentoCard({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden group bg-white/40 dark:bg-white/5 backdrop-blur-2xl border border-slate-200/60 dark:border-white/5 p-8 md:p-10 flex flex-col hover:shadow-2xl dark:hover:shadow-[0_0_30px_rgba(255,255,255,0.02)] transition-all duration-500 shadow-sm dark:shadow-none ${className}`}
    >
      {/* Dotted Grid Hover Effect */}
      <div className="absolute inset-0 bg-grid opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

      {/* Content Wrapper to stay above background */}
      <div className="relative z-10 flex flex-col h-full">
        <h3 className="text-2xl font-black tracking-tighter text-slate-900 dark:text-white transition-colors duration-300">
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}

function FeatureCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="bg-white/40 dark:bg-white/5 backdrop-blur-2xl border border-slate-200/60 dark:border-white/5 p-8 hover:bg-white/70 dark:hover:bg-white/10 hover:shadow-2xl dark:hover:shadow-sm dark:shadow-none">
      <div className="text-emerald-600 dark:text-emerald-400 mb-6 group-hover:scale-110 transition-transform origin-left">
        <svg
          className="w-8 h-8 md:w-10 md:h-10"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h3 className="text-xl font-black tracking-tighter text-slate-900 dark:text-white mb-3 transition-colors duration-300">
        {title}
      </h3>
      <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed transition-colors duration-300">
        {desc}
      </p>
    </div>
  );
}

function ContractCard({ name, id }: { name: string; id: string }) {
  return (
    <a
      href={explorerContractUrl(id)}
      target="_blank"
      rel="noreferrer"
      className="relative overflow-hidden group block bg-white/40 dark:bg-white/5 backdrop-blur-2xl border border-slate-200/60 dark:border-white/5 p-8 hover:border-emerald-400 dark:hover:border-emerald-500/40 hover:shadow-2xl dark:hover:shadow-[0_0_30px_rgba(255,255,255,0.02)] transition-all duration-500 shadow-sm dark:shadow-none"
    >
      <div className="absolute inset-0 bg-grid opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
      <div className="relative z-10">
        <div className="flex justify-between items-center mb-4">
          <p className="text-xl font-black tracking-tighter text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
            {name}
          </p>
          <ArrowUpRight className="w-5 h-5 text-emerald-600 dark:text-emerald-500 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
        </div>
        <div className="inline-block bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/5 px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400 break-all transition-colors duration-300 group-hover:dark:bg-black/70">
          {id}
        </div>
      </div>
    </a>
  );
}
