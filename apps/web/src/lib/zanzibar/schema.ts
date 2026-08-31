/**
 * SpiceDB (Google Zanzibar) schema for Accensa (#180).
 *
 * This is the canonical authorization model as a SpiceDB schema — paste it
 * into a SpiceDB instance (or the Authzed playground) to provision the
 * deployment's cluster. It is also embedded as text below so tests and fresh
 * environments can self-provision a store that speaks the same language.
 *
 * Model: `merchant` objects own permission-bearing relations, and `group`
 * objects aggregate users so an org can grant a role to many people with one
 * tuple (the `member` tuple). Rewrites and intersections are SpiceDB
 * "this"-only; the direct relations are what the tuple store writes.
 */

export const SPICEDB_SCHEMA = `
definition group {
  relation member: user
}

definition merchant {
  relation owner: user | group#member
  relation editor: user | group#member
  relation viewer: user | group#member

  permission manage_merchant = owner
  permission edit_merchant = owner + editor
  permission view_payments = owner + editor + viewer
  permission view_dashboard = owner + editor + viewer
  permission manage_team = owner
  permission manage_billing = owner
  permission delete_merchant = owner
}
`;

/** Object prefixes that make tuple identity stable and greppable. */
export const OBJECT_TYPES = {
  MERCHANT: 'merchant',
  GROUP: 'group',
} as const;

export const RELATIONS = {
  OWNER: 'owner',
  EDITOR: 'editor',
  VIEWER: 'viewer',
  MEMBER: 'member',
} as const;

/** The permission checks Accensa ships with (all expressible in the schema). */
export const PERMISSIONS = {
  MANAGE_MERCHANT: 'manage_merchant',
  EDIT_MERCHANT: 'edit_merchant',
  VIEW_PAYMENTS: 'view_payments',
  VIEW_DASHBOARD: 'view_dashboard',
  MANAGE_TEAM: 'manage_team',
  MANAGE_BILLING: 'manage_billing',
  DELETE_MERCHANT: 'delete_merchant',
} as const;

export type WildcardPermission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Validates a permission string against the schema, so a caller can never
 * probe the store with a fabricated permission name. Returns the permission
 * or null when unknown — the route layer turns a null into a 400 before the
 * store is ever consulted.
 */
export function permissionOf(value: string): WildcardPermission | null {
  return (Object.values(PERMISSIONS) as string[]).includes(value)
    ? (value as WildcardPermission)
    : null;
}