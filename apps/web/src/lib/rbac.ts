/**
 * Role-based access control for the merchant dashboard (#156).
 *
 * Merchants can grant staff read-only access to orders without handing over
 * the ability to change settings or move money. Two roles exist:
 *
 * - `admin` — the full dashboard: settings, webhook config, refunds.
 * - `viewer` — can view payments and revenue, but cannot reach developer
 *   settings, webhook configs, refunds, or any mutation endpoint.
 *
 * The role rides inside the signed session JWT (see `lib/auth.ts`) and is
 * forwarded to route handlers by `src/middleware.ts` as the
 * `x-accensa-role` header, exactly like the merchant address is forwarded
 * as `x-accensa-merchant`. Server routes re-read the header instead of
 * trusting anything a caller supplies.
 *
 * Legacy sessions minted before roles existed carry no role claim; they are
 * treated as `admin` so a 24-hour-old cookie cannot lock a merchant out of
 * their own dashboard mid-deployment. New sessions always carry an explicit
 * role.
 */

export type Role = 'admin' | 'viewer';

export const ROLES: readonly Role[] = ['admin', 'viewer'];

/** Parses a role claim, rejecting anything that is not a known role. */
export function parseRole(value: unknown): Role | null {
  return typeof value === 'string' && (value === 'admin' || value === 'viewer')
    ? value
    : null;
}

/**
 * The caller's role, from the middleware-set header.
 *
 * Missing or unknown values resolve to `admin` for backward compatibility
 * with pre-RBAC sessions (see the module comment). The header can only ever
 * be set by middleware after jwtVerify succeeds, so a request cannot forge
 * it.
 */
export function roleFromRequest(request: Request): Role {
  return parseRole(request.headers.get('x-accensa-role')) ?? 'admin';
}

/** True when the caller may perform admin-only actions. */
export function isAdmin(request: Request): boolean {
  return roleFromRequest(request) === 'admin';
 * Role-Based Access Control (RBAC) Migration to Zanzibar Model (#180).
 *
 * Implements a Google Zanzibar-inspired relationship-based access control
 * system for the Accensa dashboard. Replaces simple role checks with
 * fine-grained, auditable permission tuples.
 *
 * Model: (object#relation@user)
 *   merchant:store123#owner@user:u_abc
 *   merchant:store123#viewer@user:u_def
 *   merchant:store123#editor@group:merchants#member
 */

export type UserId = string;
export type ObjectId = string;
export type Relation = string;

/** A permission tuple: (object, relation, user). */
export interface ZanzibarTuple {
  object: ObjectId;
  relation: Relation;
  user: UserId | `group:${string}#member`;
}

/** Built-in relations matching the Accensa domain. */
export const RELATIONS = {
  OWNER: 'owner',
  EDITOR: 'editor',
  VIEWER: 'viewer',
  ADMIN: 'admin',
} as const;

/** Permission checks that can be derived from relations. */
export const PERMISSIONS = {
  // Owner can do everything
  MANAGE_MERCHANT: ['owner', 'admin'],
  // Editor can modify products, view payments
  EDIT_MERCHANT: ['owner', 'admin', 'editor'],
  VIEW_PAYMENTS: ['owner', 'admin', 'editor', 'viewer'],
  VIEW_DASHBOARD: ['owner', 'admin', 'editor', 'viewer'],
  // Only owner/admin can manage team
  MANAGE_TEAM: ['owner', 'admin'],
  MANAGE_BILLING: ['owner', 'admin'],
  DELETE_MERCHANT: ['owner'],
} as const;

export type Permission = keyof typeof PERMISSIONS;

/**
 * Simple in-memory Zanzibar-style policy store.
 * For production, back this with a database or OpenFGA/SpiceDB.
 */
export class ZanzibarStore {
  private tuples: ZanzibarTuple[] = [];

  /** Add a relationship tuple. */
  addTuple(tuple: ZanzibarTuple): void {
    const exists = this.tuples.some(
      (t) => t.object === tuple.object && t.relation === tuple.relation && t.user === tuple.user,
    );
    if (!exists) this.tuples.push(tuple);
  }

  /** Remove a relationship tuple. */
  removeTuple(tuple: ZanzibarTuple): void {
    this.tuples = this.tuples.filter(
      (t) => !(t.object === tuple.object && t.relation === tuple.relation && t.user === tuple.user),
    );
  }

  /** Check if a user has a specific relation on an object. */
  checkRelation(object: ObjectId, relation: Relation, userId: UserId): boolean {
    return this.tuples.some(
      (t) => t.object === object && t.relation === relation && t.user === userId,
    );
  }

  /** Check if a user has a permission on an object. */
  checkPermission(object: ObjectId, permission: Permission, userId: UserId): boolean {
    const allowedRelations = PERMISSIONS[permission];
    return allowedRelations.some((relation) => this.checkRelation(object, relation, userId));
  }

  /** List all users with a specific relation on an object. */
  listUsersWithRelation(object: ObjectId, relation: Relation): UserId[] {
    return this.tuples
      .filter((t) => t.object === object && t.relation === relation)
      .map((t) => t.user as UserId);
  }

  /** List all relations a user has on an object. */
  listUserRelations(object: ObjectId, userId: UserId): Relation[] {
    return this.tuples
      .filter((t) => t.object === object && t.user === userId)
      .map((t) => t.relation);
  }
}

/**
 * Middleware factory for checking permissions on API routes.
 */
export function requirePermission(store: ZanzibarStore, permission: Permission) {
  return (
    req: { user?: { id?: string }; params?: Record<string, string>; body?: Record<string, string> },
    res: { status: (code: number) => { json: (body: unknown) => unknown } },
    next: () => void,
  ) => {
    const userId = req.user?.id;
    const merchantId = req.params?.merchantId || req.body?.merchantId;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!merchantId) {
      return res.status(400).json({ error: 'Merchant ID required' });
    }

    const hasPermission = store.checkPermission(`merchant:${merchantId}`, permission, userId);
    if (!hasPermission) {
      return res.status(403).json({ error: `Permission denied: ${permission}` });
    }

    next();
  };
}
