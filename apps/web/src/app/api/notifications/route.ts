import { NextResponse } from 'next/server';
import { withClient, withMerchantClient, ensureSchema } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';
import {
  listNotifications,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  dismissNotification,
  type Notification,
} from '@/lib/notifications';

export const dynamic = 'force-dynamic';

/** How many notifications the drawer fetches in one page. */
const NOTIFICATION_LIMIT = 50;

export interface NotificationsListResponse {
  notifications: Notification[];
  unreadCount: number;
}

export type NotificationAction =
  | { action: 'mark-all-read' }
  | { action: 'mark-read'; id: number }
  | { action: 'dismiss'; id: number };

export interface NotificationActionResult {
  /** True when the action changed at least one row. */
  updated: boolean;
}

/**
 * The merchant portal's notification center: system announcements, dispute
 * updates, payout confirmations, and security alerts.
 *
 * Read/unread state lives in the `notifications` table, scoped per merchant,
 * so the badge count and the drawer survive reloads and are shared across the
 merchant's tabs.
 */
export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  try {
    const merchant = await withClient((client) => getMerchantFromRequest(client, request));
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { notifications, unreadCount } = await withMerchantClient(merchant.id, async (client) => {
      await ensureSchema(client);
      const [rows, unread] = await Promise.all([
        listNotifications(client, merchant.id, NOTIFICATION_LIMIT),
        getUnreadNotificationCount(client, merchant.id),
      ]);
      return { notifications: rows, unreadCount: unread };
    });

    const body: NotificationsListResponse = { notifications, unreadCount };
    return NextResponse.json(body, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    });
  } catch (error: unknown) {
    console.error('Error fetching notifications:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Mutates notification read/dismissal state.
 *
 * One endpoint for all three actions keeps the client a single `fetch` call
 * away from every control in the drawer (mark all read, mark one read,
 * dismiss one). The action is validated here rather than trusted from the
 * body: an unknown action is a 400, not a silent no-op.
 */
export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = parseAction(payload);
  if (!parsed) {
    return NextResponse.json(
      { error: 'action must be mark-all-read, mark-read, or dismiss' },
      { status: 400 },
    );
  }

  try {
    const merchant = await withClient((client) => getMerchantFromRequest(client, request));
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await withMerchantClient(merchant.id, async (client) => {
      await ensureSchema(client);
      switch (parsed.action) {
        case 'mark-all-read': {
          const { updated } = await markAllNotificationsAsRead(client, merchant.id);
          return { updated: updated > 0 };
        }
        case 'mark-read': {
          const updated = await markNotificationAsRead(client, merchant.id, parsed.id);
          return { updated };
        }
        case 'dismiss': {
          const dismissed = await dismissNotification(client, merchant.id, parsed.id);
          return { updated: dismissed };
        }
      }
    });

    const body: NotificationActionResult = { updated: result.updated };
    return NextResponse.json(body);
  } catch (error: unknown) {
    console.error('Error updating notifications:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Validates a POST body into a known action.
 *
 * `id` must be a positive integer for the single-notification actions — a
 * string or float would either fail the SQL cast or, worse, match nothing
 * while reporting success, so it is rejected up front.
 */
function parseAction(payload: unknown): NotificationAction | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { action, id } = payload as { action?: unknown; id?: unknown };

  if (action === 'mark-all-read') return { action: 'mark-all-read' };
  if (action !== 'mark-read' && action !== 'dismiss') return null;
  if (!Number.isInteger(id) || (id as number) < 1) return null;
  return { action, id: id as number };
}
