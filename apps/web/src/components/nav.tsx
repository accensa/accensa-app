'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './theme-toggle';
import { ArrowUpRight } from 'lucide-react';

/**
 * Shared styling for the navbar's wallet entry point.
 *
 * It points at `/coming-soon` rather than at the live wallet control. The
 * connection code works and is exercised by the refund panel, but the
 * navbar-level"connect"affordance is not being presented as shipped until the
 * connected path has been used on real hardware with the extension installed.
 * Advertising a connect button that has not been driven end to end is how the
 * previous version of this stayed broken for weeks without anyone noticing.
 */
const WALLET_CTA =
  'px-4 py-2 border font-bold text-xs uppercase tracking-wider transition-all hover:scale-[1.02] active:scale-[0.98] border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5';

export function Nav() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <>
      <nav
        data-testid="site-nav"
        className="px-6 py-4 md:py-6 fixed w-full top-0 z-50 bg-white/50 dark:bg-white/5 backdrop-blur-3xl border-b border-slate-200/50 dark:border-white/10 dark:shadow-[0_4px_30px_rgba(0,0,0,0.2),inset_0_1px_1px_rgba(255,255,255,0.1)] transition-colors duration-300"
      >
        <div className="w-full mx-auto flex items-center justify-between relative z-50">
          <Link
            href="/"
            className="text-xl md:text-2xl font-harabara font-bold tracking-wider text-slate-900 dark:text-white flex items-center gap-3 transition-colors duration-300"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/accensa-logo-no-bg.png"
              alt="Accensa Logo"
              className="w-6 h-6 md:w-8 md:h-8 shadow-sm invert hue-rotate-180 dark:invert-0 dark:hue-rotate-0"
            />
            <span>
              Accensa
              <span className="text-emerald-600 dark:text-emerald-400 text-[1.3em] inline-block -ml-[0.05em] leading-none">
                .
              </span>
            </span>
          </Link>

          {/* Desktop Nav (Centered) */}
          <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 items-center gap-8 text-xs font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            {pathname !== '/' && (
              <Link
                href="/"
                className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
              >
                Home
              </Link>
            )}
            {pathname !== '/verify' && (
              <Link
                href="/verify"
                className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
              >
                Verify
              </Link>
            )}
            {pathname !== '/dashboard' && (
              <Link
                href="/dashboard"
                className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
              >
                Dashboard
              </Link>
            )}
            <a
              href="https://accensa.github.io/accensa-app"
              className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
            >
              Docs
            </a>
            <a
              href="https://github.com/accensa"
              className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
            >
              GitHub
            </a>
          </div>

          {/* Right Nav (Theme Toggle & Connect Wallet) */}
          <div className="flex items-center gap-4">
            <Link href="/coming-soon" className={`hidden md:inline-flex ${WALLET_CTA}`}>
              Connect Wallet
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </nav>

      {/* Floating Thumb-Friendly Mobile Menu Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`md:hidden fixed bottom-6 right-6 z-[60] w-14 h-14 backdrop-blur-2xl border transition-all duration-300 active:scale-90 hover:scale-105 cursor-pointer flex flex-col items-center justify-center gap-1.5 ${
          isOpen
            ? 'bg-emerald-500 text-white border-emerald-400 shadow-[0_8px_30px_rgba(16,185,129,0.3)]'
            : 'bg-white/80 dark:bg-[#04090f]/80 border-slate-200/80 dark:border-white/20 shadow-[0_8px_30px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.6)]'
        }`}
        aria-label="Toggle Menu"
        type="button"
      >
        <span
          className={`w-6 h-0.5 transition-all duration-300 ${isOpen ? 'bg-white rotate-45 translate-y-1' : 'bg-slate-800 dark:bg-slate-100'}`}
        />
        <span
          className={`w-6 h-0.5 transition-all duration-300 ${isOpen ? 'bg-white -rotate-45 -translate-y-1' : 'bg-slate-800 dark:bg-slate-100'}`}
        />
      </button>

      {/* Full-Screen Frosted Glass Overlay (Minimalist Editorial Design) */}
      <div
        className={`md:hidden fixed inset-0 z-50 bg-white/95 dark:bg-[#04090f]/95 backdrop-blur-3xl flex flex-col justify-between p-8 pb-28 transition-all duration-500 ease-out ${
          isOpen
            ? 'opacity-100 scale-100 pointer-events-auto'
            : 'opacity-0 scale-95 pointer-events-none'
        }`}
      >
        {/* Minimal Top Header */}
        <div className="flex items-center justify-between pt-2">
          <Link
            href="/"
            onClick={() => setIsOpen(false)}
            className="text-2xl font-harabara font-bold tracking-wider text-slate-900 dark:text-white flex items-center gap-3"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/accensa-logo-no-bg.png"
              alt="Accensa Logo"
              className="w-7 h-7 shadow-sm invert hue-rotate-180 dark:invert-0 dark:hue-rotate-0"
            />
            <span>
              Accensa
              <span className="text-emerald-600 dark:text-emerald-400 text-[1.3em] inline-block -ml-[0.05em] leading-none">
                .
              </span>
            </span>
          </Link>
        </div>

        {/* Minimalist Editorial Navigation Links */}
        <div className="my-auto flex flex-col gap-7">
          <Link
            href="/"
            onClick={() => setIsOpen(false)}
            className={`text-4xl font-bold tracking-tight transition-colors flex items-center gap-3.5 ${
              pathname === '/'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-900 dark:text-white hover:text-emerald-500 dark:hover:text-emerald-400'
            }`}
          >
            Home
            {pathname === '/' && <span className="w-2.5 h-2.5 bg-emerald-500" />}
          </Link>

          <Link
            href="/verify"
            onClick={() => setIsOpen(false)}
            className={`text-4xl font-bold tracking-tight transition-colors flex items-center gap-3.5 ${
              pathname === '/verify'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-900 dark:text-white hover:text-emerald-500 dark:hover:text-emerald-400'
            }`}
          >
            Verify
            {pathname === '/verify' && <span className="w-2.5 h-2.5 bg-emerald-500" />}
          </Link>

          <Link
            href="/dashboard"
            onClick={() => setIsOpen(false)}
            className={`text-4xl font-bold tracking-tight transition-colors flex items-center gap-3.5 ${
              pathname === '/dashboard'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-900 dark:text-white hover:text-emerald-500 dark:hover:text-emerald-400'
            }`}
          >
            Dashboard
            {pathname === '/dashboard' && <span className="w-2.5 h-2.5 bg-emerald-500" />}
          </Link>

          <div className="h-px w-12 bg-slate-200 dark:bg-white/10 my-1" />

          <a
            href="https://accensa.github.io/accensa-app"
            target="_blank"
            rel="noreferrer"
            onClick={() => setIsOpen(false)}
            className="text-xl font-medium tracking-tight text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors flex items-center gap-1.5"
          >
            Documentation <ArrowUpRight className="w-4 h-4 opacity-60" />
          </a>

          <a
            href="https://github.com/accensa"
            target="_blank"
            rel="noreferrer"
            onClick={() => setIsOpen(false)}
            className="text-xl font-medium tracking-tight text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors flex items-center gap-1.5"
          >
            GitHub <ArrowUpRight className="w-4 h-4 opacity-60" />
          </a>
        </div>

        {/* Minimal Bottom CTA Button */}
        <div>
          <Link
            href="/coming-soon"
            onClick={() => setIsOpen(false)}
            className={`w-full justify-center py-4 text-sm inline-flex ${WALLET_CTA}`}
          >
            Connect Wallet
          </Link>
        </div>
      </div>
    </>
  );
}
