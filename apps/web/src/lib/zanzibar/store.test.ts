import { describe, it, expect, vi } from 'vitest';
import { PostgresZanzibarStore, DelegatingZanzibarClient } from './store';
import { PERMISSIONS, permissionOf } from './schema';

/**
 * A fake pg client whose query behaves like role_tuples under RLS: the store's
 * check() sends WHERE merchant_id = $1 AND "user" = $2, and only rows for that
 * user (within the merchant scope) come back — exactly what acting as
 * test_app_user with FORCE RLS would return.
 */
function fakeClient(rows: { relation: string; user: string }[]) {
  return {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      expect(sql).toContain('role_tuples');
      const [, user] = params as [number, string];
      return { rows: rows.filter((r) => r.user === user).map((r) => ({ relation: r.relation })) };
    }),
  };
}

describe('PostgresZanzibarStore (#180)', () => {
  it('owner grants every permission', async () => {
    const store = new PostgresZanzibarStore(
      fakeClient([{ relation: 'owner', user: 'user:u_abc' }]) as never,
    );
    for (const p of Object.values(PERMISSIONS)) {
      expect(await store.check('merchant:1', p, 'user:u_abc')).toBe(true);
    }
  });

  it('viewer grants view checks but not manage_team or billing', async () => {
    const store = new PostgresZanzibarStore(
      fakeClient([{ relation: 'viewer', user: 'user:u_abc' }]) as never,
    );
    expect(await store.check('merchant:1', PERMISSIONS.VIEW_DASHBOARD, 'user:u_abc')).toBe(true);
    expect(await store.check('merchant:1', PERMISSIONS.VIEW_PAYMENTS, 'user:u_abc')).toBe(true);
    expect(await store.check('merchant:1', PERMISSIONS.MANAGE_TEAM, 'user:u_abc')).toBe(false);
    expect(await store.check('merchant:1', PERMISSIONS.MANAGE_BILLING, 'user:u_abc')).toBe(false);
  });

  it('a user with no tuple is denied', async () => {
    const store = new PostgresZanzibarStore(fakeClient([]) as never);
    expect(await store.check('merchant:1', PERMISSIONS.VIEW_DASHBOARD, 'user:u_zzz')).toBe(false);
  });

  it('falls back to the local store when SpiceDB is unreachable', async () => {
    const local = new PostgresZanzibarStore(
      fakeClient([{ relation: 'editor', user: 'user:u_abc' }]) as never,
    );
    const remote = {
      async check(): Promise<boolean> {
        throw new Error('cluster unreachable');
      },
      async list(): Promise<never> {
        throw new Error('cluster unreachable');
      },
    };
    const client = new DelegatingZanzibarClient(remote as never, local as never);
    expect(await client.check('merchant:1', PERMISSIONS.EDIT_MERCHANT, 'user:u_abc')).toBe(true);
  });
});

describe('schema helpers', () => {
  it('permissionOf accepts known permissions and rejects unknown ones', () => {
    expect(permissionOf('view_payments')).toBe('view_payments');
    expect(permissionOf('self_destruct')).toBeNull();
  });
});