/**
 * Zanzibar tuple store (#180).
 *
 * Two layers, one interface:
 *
 * 1. A SpiceDB client that talks to a real cluster over HTTP(S) using global
 *    `fetch` — edge-safe, so the same authorization check runs on the CDN
 *    edge and on the origin.
 * 2. A Postgres-backed store (table `role_tuples`, FORCE RLS like the rest of
 *    the tenant data) that persists tuples locally. This is the source of
 *    truth for checks that must work without a cluster (local dev, tests)
 *    and the seed for a SpiceDB cluster.
 *
 * When SPICEDB_API_URL is set, authorization checks go to SpiceDB (the
 * cluster validates against the schema in zanzibar/schema.ts); otherwise the
 * Postgres table answers — the same permission semantics, so the app behaves
 * identically either way during the migration off the legacy hardcoded roles.
 */
import type { Client } from 'pg';
import { OBJECT_TYPES, permissionOf, type WildcardPermission } from './schema';

export type UserRef = string; // e.g. `user:u_abc`
export type TupleKey = { object: string; relation: string; user: UserRef };

export interface ZanzibarClient {
  /** Checks whether `user` has `permission` on `object`. */
  check(object: string, permission: WildcardPermission, user: UserRef): Promise<boolean>;
  /** Lists every tuple on an object (group memberships included). */
  list(object: string): Promise<TupleKey[]>;
}

function objectOf(merchantId: number): string {
  return `${OBJECT_TYPES.MERCHANT}:${merchantId}`;
}

/**
 * SpiceDB HTTP client.
 *
 * Speaks the SpiceDB/Kubernetes-style check over REST. `auth` is the token
 * from the SPICEDB_PRESHARED_KEY / API key; requests carry it as a bearer
 * token. Every call is a plain fetch, so this runs on the edge runtime.
 */
export class SpiceDBClient implements ZanzibarClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async check(object: string, permission: WildcardPermission, user: UserRef): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/v1/relationships/check`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        consistency: { minimize_latency: true },
        resource: { object_type: OBJECT_TYPES.MERCHANT, object_id: object.split('#')[0].split(':')[1] },
        permission,
        subject: { object: { object_type: 'user', object_id: user.replace(/^user:/, '') } },
      }),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`SpiceDB check failed: ${res.status}`);
    const body = (await res.json()) as { permitted?: boolean };
    return body.permitted === true;
  }

  async list(object: string): Promise<TupleKey[]> {
    const res = await fetch(`${this.baseUrl}/v1/relationships/read`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ tuple_filter: { resource: { object_type: OBJECT_TYPES.MERCHANT, object_id: object.split(':')[1] } } }),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`SpiceDB read failed: ${res.status}`);
    const body = (await res.json()) as { relationship_tuples?: { relationship: { resource: { object_id: string }; relation: string; subject: { object?: { object_id: string }; userset?: { userset_id: string } } } }[] };
    return (body.relationship_tuples ?? []).map(({ relationship }) => {
      const subjectId = relationship.subject.object?.object_id ?? '';
      const userset = relationship.subject.userset?.userset_id
        ? `#${relationship.subject.userset.userset_id}`
        : '';
      return {
        object: objectOf(Number(relationship.resource.object_id)),
        relation: relationship.relation,
        user: `user:${subjectId}${userset}`,
      };
    });
  }
}

/** A delegating client that falls back from SpiceDB to the local store. */
export class DelegatingZanzibarClient implements ZanzibarClient {
  constructor(
    private readonly remote: ZanzibarClient | null,
    private readonly local: ZanzibarClient,
  ) {}

  async check(object: string, permission: WildcardPermission, user: UserRef): Promise<boolean> {
    if (this.remote) {
      try {
        return await this.remote.check(object, permission, user);
      } catch {
        // A cluster outage must not lock merchants out of their dashboard;
        // the local store is the same semantics and always present.
        return this.local.check(object, permission, user);
      }
    }
    return this.local.check(object, permission, user);
  }

  list(object: string): Promise<TupleKey[]> {
    return this.remote ? this.remote.list(object) : this.local.list(object);
  }
}

/**
 * Postgres-backed local store built on `role_tuples`.
 *
 * Every table uses FORCE row-level security, so both reads and writes are
 * scoped to the connection's accensa.merchant_id — the same pattern as
 * payments. A merchant can only ever see or grant its own role tuples.
 */
export class PostgresZanzibarStore implements ZanzibarClient {
  constructor(private readonly client: Client) {}

  async check(object: string, permission: WildcardPermission, user: UserRef): Promise<boolean> {
    const merchantId = Number(object.split(':')[1]);
    if (!merchantId) return false;

    const res = await this.client.query<{ relation: string }>(
      `SELECT relation FROM role_tuples WHERE merchant_id = $1 AND "user" = $2`,
      [merchantId, user],
    );

    // Relation → permission, mirroring zanzibar/schema.ts:
    // owner and admin grant everything; editor adds edit/view; viewer reads.
    for (const row of res.rows) {
      const relation = row.relation;
      if (relation === 'owner' || relation === 'admin') return true;
      if (permission === 'view_payments' || permission === 'view_dashboard') return true;
      if ((permission === 'edit_merchant') && (relation === 'editor' || relation === 'owner' || relation === 'admin')) return true;
    }
    return false;
  }

  async list(object: string): Promise<TupleKey[]> {
    const merchantId = Number(object.split(':')[1]);
    if (!merchantId) return [];
    const res = await this.client.query<{ relation: string; user: string }>(
      `SELECT relation, "user" FROM role_tuples WHERE merchant_id = $1 ORDER BY relation, "user"`,
      [merchantId],
    );
    return res.rows.map((r) => ({ object, relation: r.relation, user: r.user as UserRef }));
  }
}

/**
 * Builds the client the routes use. Reads SPICEDB_* env vars at construction
 * time; a cluster that has never been provisioned simply falls back to the
 * Postgres table.
 */
export function zanzibarClient(
  client: Client | null,
): ZanzibarClient | null {
  if (!client) return null;
  const baseUrl = process.env.SPICEDB_API_URL;
  const token = process.env.SPICEDB_API_TOKEN ?? process.env.SPICEDB_PRESHARED_KEY ?? '';
  const remote = baseUrl ? new SpiceDBClient(baseUrl, token) : null;
  return new DelegatingZanzibarClient(remote, new PostgresZanzibarStore(client));
}

export { objectOf };
export { permissionOf };