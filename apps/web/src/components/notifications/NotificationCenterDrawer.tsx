'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  X,
  CheckCheck,
  ShieldAlert,
  Megaphone,
  Scale,
  ArrowLeftRight,
  Trash2,
  Inbox,
} from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';
import { focusRestorer, getFocusable, wrapTabTarget } from '@/lib/dialog-focus';
import { formatTimestamp, toISO8601 } from '@/lib/format-timestamp';
import {
  NOTIFICATION_CATEGORIES,
  type Notification,
  type NotificationCategory,
} from '@/lib/notifications';

/** The four drawer categories, in the order the tabs are shown. */
const CATEGORY_META: Record<
  NotificationCategory,
  { label: string; icon: typeof Bell; tone: string }
> = {
  transactions: {
    label: 'Transactions',
    icon: ArrowLeftRight,
    tone: 'text-emerald-600 dark:text-emerald-400',
  },
  disputes: { label: 'Disputes', icon: Scale, tone: 'text-amber-600 dark:text-amber-400' },
  security: { label: 'Security', icon: ShieldAlert, tone: 'text-red-600 dark:text-red-400' },
  system: { label: 'System', icon: Megaphone, tone: 'text-sky-600 dark:text-sky-400' },
};

/** Badge counts above this are shown as "99+" so the pill never grows wide. */
const BADGE_MAX = 99;

/**
 * The merchant portal's notification center: a bell in the topbar with an
 * animated unread badge, opening a slide-out drawer that groups system
 * announcements, dispute updates, payout confirmations, and security alerts
 * by category.
 *
 * Read/unread state is owned by the server (`/api/notifications`); this
 * component only renders it and posts mutations, so the badge and the drawer
 * agree with the database even across reloads and tabs.
 */
export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const {
    notifications,
    unreadCount,
    loading,
    error,
    markAllAsRead,
    markAsRead,
    dismiss,
  } = useNotifications();

  return (
    <>
      <NotificationBell unreadCount={unreadCount} onClick={() => setOpen(true)} />
      <NotificationDrawer
        open={open}
        onClose={() => setOpen(false)}
        notifications={notifications}
        unreadCount={unreadCount}
        loading={loading}
        error={error}
        onMarkAllAsRead={markAllAsRead}
        onMarkAsRead={markAsRead}
        onDismiss={dismiss}
      />
    </>
  );
}

/**
 * The bell button with its unread badge.
 *
 * The badge re-mounts on every count change (`key={unreadCount}`) so the pop
 * animation in globals.css replays each time the number moves — a merchant
 * watching the dashboard sees the badge react the moment a sync lands a new
 * payout confirmation, not only when they next open the drawer.
 */
export function NotificationBell({
  unreadCount,
  onClick,
}: {
  unreadCount: number;
  onClick: () => void;
}) {
  const capped = unreadCount > BADGE_MAX;

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="notification-bell"
      aria-label={
        unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
      }
      className="relative p-2 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors cursor-pointer"
    >
      <Bell className="w-5 h-5" />
      {unreadCount > 0 && (
        <span
          key={unreadCount}
          data-testid="notification-badge"
          aria-hidden="true"
          className="notification-badge-pop absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 flex items-center justify-center rounded-full bg-red-600 dark:bg-red-500 text-white text-[10px] font-bold leading-none"
        >
          {capped ? `${BADGE_MAX}+` : unreadCount}
        </span>
      )}
    </button>
  );
}

export interface NotificationDrawerProps {
  open: boolean;
  onClose: () => void;
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  onMarkAllAsRead: () => Promise<void>;
  onMarkAsRead: (id: number) => Promise<void>;
  onDismiss: (id: number) => Promise<void>;
}

/**
 * The slide-out drawer listing the merchant's notifications.
 *
 * Focus moves in on open, Tab is trapped inside, Escape and a backdrop click
 * both close, and focus returns to the bell — the same contract the payment
 * details modal implements via `lib/dialog-focus`.
 */
export function NotificationDrawer({
  open,
  onClose,
  notifications,
  unreadCount,
  loading,
  error,
  onMarkAllAsRead,
  onMarkAsRead,
  onDismiss,
}: NotificationDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const [category, setCategory] = useState<NotificationCategory | 'all'>('all');
  const [busy, setBusy] = useState(false);

  // A real modal dialog: focus moves in on open, Tab is trapped inside, Escape
  // and a backdrop click both close, and focus returns to whatever opened it.
  useEffect(() => {
    if (!open) return;
    const restoreFocus = focusRestorer(
      typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
    );

    const drawer = drawerRef.current;
    if (drawer) {
      const focusable = getFocusable(drawer);
      (focusable[0] ?? drawer).focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'Tab' && drawer) {
        const target = wrapTabTarget(
          getFocusable(drawer),
          document.activeElement as HTMLElement | null,
          event.shiftKey,
        );
        if (target) {
          event.preventDefault();
          target.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreFocus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const visible =
    category === 'all' ? notifications : notifications.filter((n) => n.category === category);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70]" data-testid="notification-drawer">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[#04090f]/50 dark:bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-drawer-heading"
        tabIndex={-1}
        className="notification-drawer-in absolute right-0 top-0 h-full w-full max-w-md bg-white/95 dark:bg-[#0c131d]/95 backdrop-blur-2xl border-l border-slate-200 dark:border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.2)] dark:shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col outline-none"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200/60 dark:border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h2
              id="notification-drawer-heading"
              className="text-lg font-black tracking-tight text-slate-900 dark:text-white truncate"
            >
              Notifications
            </h2>
            {unreadCount > 0 && (
              <span
                data-testid="drawer-unread-count"
                className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded-full bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20"
              >
                {unreadCount} unread
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => run(onMarkAllAsRead)}
              disabled={busy || unreadCount === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all read
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close notifications"
              className="p-1.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Category tabs */}
        <div
          className="px-4 py-3 border-b border-slate-200/60 dark:border-white/10 flex gap-2 overflow-x-auto shrink-0"
          role="tablist"
          aria-label="Filter notifications by category"
        >
          <CategoryTab
            active={category === 'all'}
            label="All"
            onClick={() => setCategory('all')}
          />
          {NOTIFICATION_CATEGORIES.map((c) => (
            <CategoryTab
              key={c}
              active={category === c}
              label={CATEGORY_META[c].label}
              icon={CATEGORY_META[c].icon}
              onClick={() => setCategory(c)}
            />
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto" data-testid="notification-list">
          {error && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-3 px-8">
              <div className="w-12 h-12 bg-red-100 dark:bg-red-500/10 flex items-center justify-center text-red-600 dark:text-red-400">
                <Inbox className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-slate-900 dark:text-white">
                Couldn&apos;t load notifications
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{error}</p>
            </div>
          )}

          {!error && loading && notifications.length === 0 && (
            <div className="divide-y divide-slate-100 dark:divide-white/5" aria-hidden="true">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="px-6 py-5 flex gap-4 animate-pulse">
                  <div className="w-9 h-9 rounded-full bg-slate-200/80 dark:bg-white/10 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-2/3 bg-slate-200/80 dark:bg-white/10" />
                    <div className="h-3 w-full bg-slate-200/60 dark:bg-white/5" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!error && !loading && visible.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-3 px-8">
              <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                <Inbox className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-slate-900 dark:text-white">
                {notifications.length === 0 ? 'No notifications yet' : `No ${CATEGORY_META[category as NotificationCategory]?.label ?? ''} notifications`}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {notifications.length === 0
                  ? 'Announcements, dispute updates, payout confirmations, and security alerts will appear here.'
                  : 'Try a different category.'}
              </p>
            </div>
          )}

          {!error && visible.length > 0 && (
            <ul className="divide-y divide-slate-100 dark:divide-white/5">
              {visible.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onMarkAsRead={() => run(() => onMarkAsRead(notification.id))}
                  onDismiss={() => run(() => onDismiss(notification.id))}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryTab({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon?: typeof Bell;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors whitespace-nowrap cursor-pointer ${
        active
          ? 'border-emerald-600 dark:border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5'
      }`}
    >
      {Icon && <Icon className="w-3.5 h-3.5" />}
      {label}
    </button>
  );
}

function NotificationRow({
  notification,
  onMarkAsRead,
  onDismiss,
}: {
  notification: Notification;
  onMarkAsRead: () => void;
  onDismiss: () => void;
}) {
  const meta = CATEGORY_META[notification.category];
  const Icon = meta.icon;

  return (
    <li
      className={`px-6 py-5 flex gap-4 group ${
        notification.read
          ? 'bg-transparent'
          : 'bg-emerald-50/50 dark:bg-emerald-500/[0.04]'
      }`}
    >
      <div
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
          notification.read
            ? 'bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-500'
            : 'bg-emerald-100 dark:bg-emerald-500/10'
        }`}
      >
        <Icon className={`w-4 h-4 ${notification.read ? '' : meta.tone}`} />
      </div>

      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-start justify-between gap-3">
          <p
            className={`text-sm leading-snug ${
              notification.read
                ? 'text-slate-600 dark:text-slate-300'
                : 'text-slate-900 dark:text-white font-bold'
            }`}
          >
            {notification.title}
          </p>
          {!notification.read && (
            <span
              aria-label="Unread"
              className="mt-1.5 w-2 h-2 rounded-full bg-emerald-500 shrink-0"
            />
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          {notification.body}
        </p>
        <div className="flex items-center justify-between gap-3 pt-1">
          <time
            dateTime={toISO8601(notification.created_at)}
            title={toISO8601(notification.created_at)}
            className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500"
          >
            {formatTimestamp(notification.created_at)}
          </time>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
            {!notification.read && (
              <button
                type="button"
                onClick={onMarkAsRead}
                aria-label={`Mark "${notification.title}" as read`}
                className="p-1.5 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer"
              >
                <CheckCheck className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={onDismiss}
              aria-label={`Dismiss "${notification.title}"`}
              className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
