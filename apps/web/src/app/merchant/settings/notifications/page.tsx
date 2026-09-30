'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface SettingsResponse {
  telegramConfigured: boolean;
  telegramChatId: string | null;
  discordConfigured: boolean;
  eventFilter: 'settlements' | 'disputes' | 'all';
}

const EMPTY_SETTINGS: SettingsResponse = {
  telegramConfigured: false,
  telegramChatId: null,
  discordConfigured: false,
  eventFilter: 'all',
};

export default function NotificationsSettingsPage() {
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingTest, setPendingTest] = useState<'telegram' | 'discord' | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    fetch('/api/merchant/settings/notifications', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok)
          throw new Error((await response.json()).error ?? 'Could not load settings');
        return response.json() as Promise<SettingsResponse>;
      })
      .then((data) => {
        setSettings(data);
        setTelegramChatId(data.telegramChatId ?? '');
      })
      .catch((error: unknown) =>
        setNotice(error instanceof Error ? error.message : 'Could not load settings'),
      )
      .finally(() => setLoading(false));
  }, []);

  async function saveSettings() {
    setSaving(true);
    setNotice('');
    try {
      const response = await fetch('/api/merchant/settings/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventFilter: settings.eventFilter,
          telegramBotToken,
          telegramChatId,
          discordWebhookUrl,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not save settings');
      setSettings(data);
      setTelegramBotToken('');
      setDiscordWebhookUrl('');
      setNotice('Notification settings saved.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save settings');
    } finally {
      setSaving(false);
    }
  }

  async function clearChannel(platform: 'telegram' | 'discord') {
    const response = await fetch('/api/merchant/settings/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        platform === 'telegram' ? { clearTelegram: true } : { clearDiscord: true },
      ),
    });
    const data = await response.json();
    if (!response.ok) {
      setNotice(data.error ?? 'Could not remove notification destination');
      return;
    }
    setSettings(data);
    if (platform === 'telegram') setTelegramChatId('');
    setNotice(`${platform === 'telegram' ? 'Telegram' : 'Discord'} destination removed.`);
  }

  async function sendTest(platform: 'telegram' | 'discord') {
    setPendingTest(platform);
    setNotice('');
    try {
      const response = await fetch('/api/merchant/settings/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Test notification failed');
      setNotice(`${platform === 'telegram' ? 'Telegram' : 'Discord'} test notification sent.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Test notification failed');
    } finally {
      setPendingTest(null);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 text-slate-900 dark:text-slate-100">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
            Merchant settings
          </p>
          <h1 className="mt-2 text-2xl font-bold">Chat notifications</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            Send new settlement or dispute alerts to a Telegram chat or Discord channel. Credentials
            stay on the server and are never returned to this page.
          </p>
        </div>
        <Link
          className="shrink-0 text-sm text-slate-600 underline underline-offset-4 dark:text-slate-300"
          href="/dashboard"
        >
          Dashboard
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading notification settings…</p>
      ) : (
        <div className="space-y-8">
          <section className="border-t border-slate-200 pt-6 dark:border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Telegram</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {settings.telegramConfigured
                    ? `Connected to ${settings.telegramChatId}`
                    : 'Not connected'}
                </p>
              </div>
              {settings.telegramConfigured && (
                <button
                  type="button"
                  onClick={() => void sendTest('telegram')}
                  disabled={pendingTest !== null}
                  className="border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/5"
                >
                  {pendingTest === 'telegram' ? 'Sending…' : 'Send test'}
                </button>
              )}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Bot token
                <input
                  type="password"
                  autoComplete="new-password"
                  value={telegramBotToken}
                  onChange={(event) => setTelegramBotToken(event.target.value)}
                  placeholder={
                    settings.telegramConfigured ? 'Saved; enter to replace' : '123456:bot-token'
                  }
                  className="mt-1 block w-full border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-white/20"
                />
              </label>
              <label className="block text-sm font-medium">
                Chat ID
                <input
                  value={telegramChatId}
                  onChange={(event) => setTelegramChatId(event.target.value)}
                  placeholder="Chat or channel ID"
                  className="mt-1 block w-full border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-white/20"
                />
              </label>
            </div>
            {settings.telegramConfigured && (
              <button
                type="button"
                onClick={() => void clearChannel('telegram')}
                className="mt-3 text-xs font-medium text-rose-700 underline underline-offset-2 dark:text-rose-400"
              >
                Remove Telegram destination
              </button>
            )}
          </section>

          <section className="border-t border-slate-200 pt-6 dark:border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Discord</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {settings.discordConfigured ? 'Webhook connected' : 'Not connected'}
                </p>
              </div>
              {settings.discordConfigured && (
                <button
                  type="button"
                  onClick={() => void sendTest('discord')}
                  disabled={pendingTest !== null}
                  className="border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/5"
                >
                  {pendingTest === 'discord' ? 'Sending…' : 'Send test'}
                </button>
              )}
            </div>
            <label className="mt-4 block text-sm font-medium">
              Discord webhook URL
              <input
                type="password"
                autoComplete="new-password"
                value={discordWebhookUrl}
                onChange={(event) => setDiscordWebhookUrl(event.target.value)}
                placeholder={
                  settings.discordConfigured
                    ? 'Saved; enter to replace'
                    : 'https://discord.com/api/webhooks/...'
                }
                className="mt-1 block w-full border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-white/20"
              />
            </label>
            {settings.discordConfigured && (
              <button
                type="button"
                onClick={() => void clearChannel('discord')}
                className="mt-3 text-xs font-medium text-rose-700 underline underline-offset-2 dark:text-rose-400"
              >
                Remove Discord destination
              </button>
            )}
          </section>

          <section className="border-y border-slate-200 py-6 dark:border-white/10">
            <label className="block max-w-sm text-sm font-medium">
              Notify me about
              <select
                value={settings.eventFilter}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    eventFilter: event.target.value as SettingsResponse['eventFilter'],
                  }))
                }
                className="mt-2 block w-full border border-slate-300 bg-transparent px-3 py-2 dark:border-white/20"
              >
                <option value="settlements">Settlements only</option>
                <option value="disputes">Disputes only</option>
                <option value="all">All events</option>
              </select>
            </label>
          </section>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => void saveSettings()}
              disabled={saving}
              className="bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
            <p
              role="status"
              aria-live="polite"
              className="text-sm text-slate-600 dark:text-slate-300"
            >
              {notice}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
