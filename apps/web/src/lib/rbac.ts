/**
 * Legacy RBAC entry point — now a thin re-export of the Zanzibar model (#180).
 *
 * The original hardcoded role checks lived here. They have been replaced by
 * the relationship-based model in lib/zanzibar (schema + store + permissions)
 * backed by Postgres, with an optional SpiceDB cluster. Anything that imported
 * this module keeps working: the same checks now evaluate tuples instead of
 * hardcoded arrays, and merchants can define their own grants through
 * /api/roles.
 */
export {
  PERMISSIONS,
  RELATIONS,
  OBJECT_TYPES,
} from './zanzibar/schema';

export {
  SpiceDBClient,
  PostgresZanzibarStore,
  DelegatingZanzibarClient,
  zanzibarClient,
  objectOf,
} from './zanzibar/store';

export { authorize, can } from './zanzibar/permissions';