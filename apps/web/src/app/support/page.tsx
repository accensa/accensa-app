import React from 'react';
import type { Metadata } from 'next';
import { PageContainer } from '@/components/page-container';
import { SecureChat } from '@/components/secure-chat';

export const metadata: Metadata = {
  title: 'Support — Accensa',
  description: 'End-to-end encrypted support chat for Accensa merchants.',
};

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-white dark:bg-[#04090f] text-slate-600 dark:text-slate-200 font-sans selection:bg-slate-200 dark:selection:bg-white/10 transition-colors duration-300">
      <PageContainer width="narrow" className="px-6 pb-20 pt-28 md:pt-32">
        <header className="mb-8">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.25em] text-emerald-700 dark:text-emerald-400">
            Secure channel
          </p>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tighter text-slate-900 dark:text-white">
            Support
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Message our team through an end-to-end encrypted conversation. The session key is
            derived from your Stellar wallet, so your messages are sealed before they ever touch
            our servers.
          </p>
        </header>
        <SecureChat />
      </PageContainer>
    </main>
  );
}
