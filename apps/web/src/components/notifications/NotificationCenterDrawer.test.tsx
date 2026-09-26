import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  NotificationBell,
  NotificationDrawer,
} from './NotificationCenterDrawer';
import type { Notification } from '@/lib/notifications';

const NOTIFICATIONS: Notification[] = [
  {
    id: 1,
    category: 'transactions',
    title: 'Payout confirmed',
    body: '100.00 USDC settled to your account.',
    read: false,
    created_at: '2026-09-26T12:00:00.000Z',
    read_at: null,
  },
  {
    id: 2,
    category: 'security',
    title: 'New sign-in',
    body: 'A new device signed in to your account.',
    read: false,
    created_at: '2026-09-26T11:00:00.000Z',
    read_at: null,
  },
  {
    id: 3,
    category: 'system',
    title: 'Scheduled maintenance',
    body: 'The dashboard will be read-only on Sunday 02:00 UTC.',
    read: true,
    created_at: '2026-09-25T09:00:00.000Z',
    read_at: '2026-09-25T10:00:00.000Z',
  },
];

const noop = () => {};

function renderBell(unreadCount: number) {
  return renderToString(<NotificationBell unreadCount={unreadCount} onClick={noop} />);
}

function renderDrawer(props: Partial<Parameters<typeof NotificationDrawer>[0]> = {}) {
  return renderToString(
    <NotificationDrawer
      open={true}
      onClose={noop}
      notifications={NOTIFICATIONS}
      unreadCount={2}
      loading={false}
      error={null}
      onMarkAllAsRead={noop}
      onMarkAsRead={noop}
      onDismiss={noop}
      {...props}
    />,
  );
}

describe('NotificationBell', () => {
  it('announces the unread count to assistive technology', () => {
    const html = renderBell(3);
    expect(html).toContain('aria-label="Notifications, 3 unread"');
  });

  it('renders the badge with the count when there are unread notifications', () => {
    const html = renderBell(3);
    expect(html).toContain('data-testid="notification-badge"');
    expect(html).toContain('>3</span>');
  });

  it('caps the badge at 99+ for large counts', () => {
    const html = renderBell(150);
    expect(html).toContain('99+');
  });

  it('hides the badge entirely when everything is read', () => {
    const html = renderBell(0);
    expect(html).not.toContain('data-testid="notification-badge"');
    expect(html).toContain('aria-label="Notifications"');
  });
});

describe('NotificationDrawer', () => {
  it('is announced as a modal dialog with an accessible name', () => {
    const html = renderDrawer();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="notification-drawer-heading"');
    expect(html).toContain('id="notification-drawer-heading"');
    expect(html).toContain('Notifications');
  });

  it('gives the dialog a focus target and labels the close control', () => {
    const html = renderDrawer();
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-label="Close notifications"');
  });

  it('shows the unread count in the header', () => {
    const html = renderDrawer();
    expect(html).toContain('2 unread');
  });

  it('offers a Mark all read action', () => {
    const html = renderDrawer();
    expect(html).toContain('Mark all read');
  });

  it('lists every notification with its title and body', () => {
    const html = renderDrawer();
    expect(html).toContain('Payout confirmed');
    expect(html).toContain('100.00 USDC settled to your account.');
    expect(html).toContain('New sign-in');
    expect(html).toContain('Scheduled maintenance');
  });

  it('marks unread rows with an unread indicator', () => {
    const html = renderDrawer();
    expect(html).toContain('aria-label="Unread"');
  });

  it('gives each row mark-as-read and dismiss controls with accessible labels', () => {
    const html = renderDrawer();
    expect(html).toContain('aria-label="Mark &quot;Payout confirmed&quot; as read"');
    expect(html).toContain('aria-label="Dismiss &quot;Payout confirmed&quot;"');
  });

  it('renders the four category tabs plus All', () => {
    const html = renderDrawer();
    expect(html).toContain('All');
    expect(html).toContain('Transactions');
    expect(html).toContain('Disputes');
    expect(html).toContain('Security');
    expect(html).toContain('System');
  });

  it('shows an empty state when there are no notifications at all', () => {
    const html = renderDrawer({ notifications: [], unreadCount: 0 });
    expect(html).toContain('No notifications yet');
  });

  it('shows the error state when the fetch failed', () => {
    const html = renderDrawer({ error: 'Internal Server Error' });
    expect(html).toContain("Couldn&#x27;t load notifications");
    expect(html).toContain('Internal Server Error');
  });

  it('shows skeleton rows while loading with no data yet', () => {
    const html = renderDrawer({ loading: true, notifications: [] });
    expect(html).toContain('animate-pulse');
  });

  it('disables Mark all read when there is nothing unread', () => {
    const html = renderDrawer({ unreadCount: 0 });
    expect(html).toMatch(/<button[^>]*disabled/);
  });
});

describe('NotificationCenter (closed by default)', () => {
  it('renders only the bell until opened', () => {
    // The drawer returns null when closed, so a closed center is bell-only.
    // NotificationCenter itself is exercised through the bell/drawer exports
    // above; this pins the closed-drawer contract.
    const html = renderToString(
      <NotificationDrawer
        open={false}
        onClose={noop}
        notifications={NOTIFICATIONS}
        unreadCount={2}
        loading={false}
        error={null}
        onMarkAllAsRead={noop}
        onMarkAsRead={noop}
        onDismiss={noop}
      />,
    );
    expect(html).toBe('');
  });
});

// The drawer's focus trap and focus restoration are unit-tested in
// `lib/dialog-focus.test.ts`; a full mount-and-Tab integration test would need
// jsdom, which this project's Node test setup does not include.
