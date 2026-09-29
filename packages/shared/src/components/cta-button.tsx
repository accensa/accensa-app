import React from 'react';
import Link from 'next/link';

/**
 * The hero call-to-action pair.
 *
 * Both buttons share one base — same border, padding, and press response — and
 * differ only in fill. They were previously built from separate recipes, which
 * left the bordered one 2px taller than its neighbour, gave the other a
 * `hover:border-*` rule it could never apply (its border-width was 0), and let
 * only one of the two respond to touch.
 */
export type CtaVariant = 'primary' | 'secondary';

const BASE =
  'px-8 py-4 border font-bold text-sm uppercase tracking-wider transition-all hover:scale-[1.02] active:scale-[0.98] shadow-sm dark:shadow-none text-slate-900 dark:text-white text-center';

const VARIANTS: Record<CtaVariant, string> = {
  primary:
    'bg-white/40 dark:bg-white/10 backdrop-blur-xl border-slate-200/50 dark:border-white/20 hover:bg-white/60 dark:hover:bg-white/20',
  secondary:
    'bg-white dark:bg-white/[0.02] dark:backdrop-blur-md border-slate-200/50 dark:border-white/20 hover:bg-slate-50 dark:hover:bg-white/[0.06] hover:border-slate-300 dark:hover:border-white/30',
};

export function CtaButton({
  href,
  variant = 'primary',
  className = '',
  children,
}: {
  href: string;
  variant?: CtaVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={`${BASE} ${VARIANTS[variant]} ${className}`}>
      {children}
    </Link>
  );
}
