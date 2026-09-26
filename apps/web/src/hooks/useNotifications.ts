'use client';

import useSWR from 'swr';
import { useCallback } from 'react';
import type { Notification, NotificationAction } from '@/lib/notifications';

/** How often the drawer re-fetches so the badge count stays live. */
export const NOTIFICATION_POLL_INTERVAL_MS = 15_000;

export interface NotificationsListResponse {
  notifications: Notification[];
  unreadCount: number;
}

export interface UseNotificationsResult {
  /** The merchant's notifications, newest first; empty until the first fetch resolves. */
  notifications: Notification[];
  /** Live unread count for the bell badge. */
  unreadCount: number;
  /** True until the first fetch resolves. */
  loading: boolean;
  /** The last fetch error, or null. */
  error: string | null;
  /** Marks every unread notification as read and revalidates. */
  markAllAsRead: () => Promise<void>;
  /** Marks one notification as read and revalidates. */
  markAsRead: (id: number) => Promise<void>;
  /** Dismisses (deletes) one notification and revalidates. */
  dismiss: (id: number) => Promise<void>;
}

/**
 * Fetches the merchant's notification list and unread count.
 *
 * Separated from the hook so it can be tested with a mocked `fetch` and no
 * DOM — the same reason `payments-csv` keeps its serialization out of the
 * component.
 */
export async function fetchNotifications(signal?: AbortSignal): Promise<NotificationsListResponse> {
  const res = await fetch('/api/notifications', { cache: 'no-store', signal });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Error ${res.status}`);
  }
  return res.json();
}

/**
 * Posts a read/dismissal action to the notification center.
 *
 * Returns the server's `updated` flag so callers can tell a real change from
 * a no-op (e.g. dismissing an already-dismissed id).
 */
export async function postNotificationAction(
  action: NotificationAction,
  signal?: AbortSignal,
): Promise<{ updated: boolean }> {
  const res = await fetch('/api/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Error ${res.status}`);
  }
  return res.json();
}

/**
 * Subscribes the notification center to `/api/notifications`.
 *
 * The list is polled on an interval so the unread badge updates while the
 * dashboard is open — announcements, dispute updates, and security alerts are
 * produced by the sync pipeline, not by anything the merchant does, so a
 * refetch-on-focus-only model would leave the badge stale for hours.
 *
 * Every mutation revalidates through SWR's `mutate`, so the drawer and the
 * badge never show a read/unread state the database does not agree with.
 */
export function useNotifications(): UseNotificationsResult {
  const { data, error, mutate, isLoading } = useSWR<NotificationsListResponse>(
    '/api/notifications',
    fetchNotifications,
    {
      refreshInterval: NOTIFICATION_POLL_INTERVAL_MS,
      keepPreviousData: true,
    },
  );

  const runAction = useCallback(
    async (action: NotificationAction) => {
      await postNotificationAction(action);
      // Revalidate even when the action reports no change: the poll may have
      // raced a sync, and a stale drawer is worse than one extra request.
      await mutate();
    },
    [mutate],
  );

  const markAllAsRead = useCallback(() => runAction({ action: 'mark-all-read' }), [runAction]);
  const markAsRead = useCallback((id: number) => runAction({ action: 'mark-read', id }), [runAction]);
  const dismiss = useCallback((id: number) => runAction({ action: 'dismiss', id }), [runAction]);

  return {
    notifications: data?.notifications ?? [],
    unreadCount: data?.unreadCount ?? 0,
    loading: isLoading && !data,
    error: error instanceof Error ? error.message : null,
    markAllAsRead,
    markAsRead,
    dismiss,
  };
}
