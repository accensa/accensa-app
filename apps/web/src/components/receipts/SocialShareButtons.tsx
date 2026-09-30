'use client';

import { useEffect, useState } from 'react';
import { createSocialShareLinks } from '@/lib/receipt-share';

export function SocialShareButtons({
  txHash,
  amount,
  asset,
}: {
  txHash: string;
  amount: string;
  asset: string;
}) {
  const [anchored, setAnchored] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/receipts/${encodeURIComponent(txHash)}`, { signal: controller.signal })
      .then((response) => setAnchored(response.ok))
      .catch(() => setAnchored(false));
    return () => controller.abort();
  }, [txHash]);

  const links =
    typeof window === 'undefined'
      ? null
      : createSocialShareLinks(window.location.origin, txHash, amount, asset);

  if (anchored === false) {
    return (
      <p className="text-xs text-slate-500">
        Social sharing is available after the receipt is anchored.
      </p>
    );
  }

  if (anchored !== true || !links) {
    return (
      <p className="text-xs text-slate-500" aria-live="polite">
        Checking receipt availability…
      </p>
    );
  }

  return (
    <div>
      <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300">
        Share anchored payment
      </p>
      <div className="flex flex-wrap gap-2">
        <a
          href={links.x}
          target="_blank"
          rel="noreferrer"
          className="border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 dark:border-white/20 dark:text-white dark:hover:bg-white/5"
        >
          Share to X
        </a>
        <a
          href={links.warpcast}
          target="_blank"
          rel="noreferrer"
          className="border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 dark:border-white/20 dark:text-white dark:hover:bg-white/5"
        >
          Share to Warpcast
        </a>
        <a
          href={links.bluesky}
          target="_blank"
          rel="noreferrer"
          className="border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 dark:border-white/20 dark:text-white dark:hover:bg-white/5"
        >
          Share to Bluesky
        </a>
      </div>
    </div>
  );
}
