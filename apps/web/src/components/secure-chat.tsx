'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, Send, Trash2 } from 'lucide-react';
import { readStatus, truncateAddress } from '@/lib/freighter';
import { SecureChatClient, type UnlockResult } from '@/lib/chat/secure-chat';
import type { ChatMessage, StorageLike } from '@/lib/chat/session';

type ChatStatus =
  | { kind: 'loading' }
  | { kind: 'no-wallet' }
  | { kind: 'unlocked'; fresh: boolean }
  | { kind: 'different-wallet' }
  | { kind: 'error'; message: string };

function storage(): StorageLike {
  return typeof window === 'undefined' ? new MemoryStorage() : window.localStorage;
}

// Minimal in-memory Storage for SSR guard (never actually used on the server).
class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/**
 * End-to-end encrypted support chat.
 *
 * The merchant's Stellar wallet unlocks (or creates) an encrypted session;
 * messages are sealed with AES-256-GCM derived from the wallet address before
 * they are stored, and only ciphertext is ever persisted.
 */
export function SecureChat({ className = '' }: { className?: string }) {
  const clientRef = useRef<SecureChatClient | null>(null);
  const [status, setStatus] = useState<ChatStatus>({ kind: 'loading' });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [merchantAddress, setMerchantAddress] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [transientError, setTransientError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const refreshMessages = useCallback(() => {
    const client = clientRef.current;
    if (client) setMessages([...client.messages]);
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      const wallet = await readStatus();
      if (!live) return;
      if (wallet.kind !== 'connected') {
        setStatus({ kind: 'no-wallet' });
        return;
      }
      const client = new SecureChatClient(storage());
      clientRef.current = client;
      const result: UnlockResult = await client.unlock(wallet.address);
      if (!live) return;
      if (result.kind === 'unlocked') {
        setMerchantAddress(wallet.address);
        setStatus({ kind: 'unlocked', fresh: result.fresh });
        refreshMessages();
      } else if (result.kind === 'locked') {
        setStatus({ kind: 'different-wallet' });
      } else {
        setStatus({ kind: 'error', message: result.message });
      }
    })();
    return () => {
      live = false;
    };
  }, [refreshMessages]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !draft.trim()) return;
    setSending(true);
    setTransientError(null);
    try {
      await client.send(draft);
      setDraft('');
      refreshMessages();
    } catch (error: unknown) {
      setTransientError(error instanceof Error ? error.message : 'Could not send the message');
    } finally {
      setSending(false);
    }
  }, [draft, refreshMessages]);

  const handleReset = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    client.reset();
    setMessages([]);
    setTransientError(null);
    setStatus({ kind: 'unlocked', fresh: true });
  }, []);

  const [plain, setPlain] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    void (async () => {
      const client = clientRef.current;
      if (!client) return;
      const next: Record<string, string> = {};
      for (const message of messages) {
        try {
          next[message.id] = await client.read(message);
        } catch {
          next[message.id] = '[unreadable]';
        }
      }
      if (live) setPlain(next);
    })();
    return () => {
      live = false;
    };
  }, [messages]);

  return (
    <section
      className={`w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] shadow-sm ${className}`}
      aria-label="Encrypted support chat"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 dark:border-white/10 px-5 py-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-wide">
            Secure Support Chat
          </h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Lock className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            End-to-end encrypted
          </p>
        </div>
        {status.kind === 'unlocked' && merchantAddress && (
          <div className="text-right">
            <p className="text-xs text-slate-500 dark:text-slate-400">Merchant wallet</p>
            <p className="font-mono text-xs text-slate-800 dark:text-slate-200">
              {truncateAddress(merchantAddress)}
            </p>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-5">
        {status.kind === 'loading' && (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Checking wallet connection…
          </p>
        )}

        {status.kind === 'no-wallet' && (
          <div className="py-8 text-center">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Connect your Freighter wallet to start an encrypted support conversation.
            </p>
            <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
              The chat key is derived from your wallet address — no message is ever stored in
              plaintext.
            </p>
          </div>
        )}

        {status.kind === 'different-wallet' && (
          <div className="py-8 text-center" role="alert">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              This transcript belongs to a different wallet.
            </p>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Connect the wallet that started the conversation, or reset the session to begin a new
              one.
            </p>
            <button
              type="button"
              onClick={handleReset}
              className="mt-4 inline-flex items-center gap-2 rounded-md border border-slate-300 dark:border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Reset session
            </button>
          </div>
        )}

        {status.kind === 'error' && (
          <p className="py-8 text-center text-sm text-red-600 dark:text-red-400" role="alert">
            {status.message}
          </p>
        )}

        {status.kind === 'unlocked' && (
          <>
            {status.fresh && (
              <p
                className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                role="status"
              >
                New encrypted session created for this wallet.
              </p>
            )}

            {/* Transcript */}
            <div
              ref={listRef}
              className="max-h-80 space-y-3 overflow-y-auto rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 p-4"
              aria-live="polite"
              aria-label="Support conversation"
            >
              {messages.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
                  No messages yet. Send the first encrypted message below.
                </p>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === 'merchant' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3.5 py-2 text-sm ${
                        message.role === 'merchant'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white text-slate-800 dark:bg-white/10 dark:text-slate-200'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{plain[message.id] ?? '…'}</p>
                      <p
                        className={`mt-1 text-[10px] ${
                          message.role === 'merchant'
                            ? 'text-emerald-100/80'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {message.role === 'merchant' ? 'You' : 'Buyer'} ·{' '}
                        {new Date(message.createdAt).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {transientError && (
              <p className="mt-3 text-xs text-red-600 dark:text-red-400" role="alert">
                {transientError}
              </p>
            )}

            {/* Composer */}
            <form
              className="mt-4 flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSend();
              }}
            >
              <label htmlFor="support-chat-message" className="sr-only">
                Support message
              </label>
              <textarea
                id="support-chat-message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                rows={2}
                placeholder="Write an encrypted message…"
                className="min-h-[44px] flex-1 resize-none rounded-md border border-slate-300 dark:border-white/15 bg-white dark:bg-black/30 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-emerald-600 focus:outline-none"
              />
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Send encrypted message"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                Send
              </button>
            </form>

            <div className="mt-4 flex items-center justify-between">
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                Messages are encrypted with a key derived from your wallet and stored as ciphertext.
              </p>
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                New conversation
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
