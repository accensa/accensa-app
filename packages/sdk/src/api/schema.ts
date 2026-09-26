/**
 * Named aliases for every schema in the Accensa indexer OpenAPI spec.
 *
 * The spec (`apps/web/openapi.yaml`) is the single source of truth for the
 * indexer's wire shapes, and `generated/api-types.ts` is its mechanical
 * translation. The problem with consuming that file directly is that every
 * reference is a deep index chain:
 *
 * ```ts
 * type Body = operations['reportSettlement']['requestBody']['content']['application/json'];
 * ```
 *
 * That is unreviewable, ungreppable, and breaks wholesale when the spec is
 * regenerated. This module replaces those chains with names, one per schema,
 * so a reader can see the API surface in a single screen and a rename shows
 * up as one line changed rather than sixty.
 *
 * `ApiSchemas` exists so the alias list is machine-checkable: `keyof
 * ApiSchemas` is asserted to equal `keyof components['schemas']` in
 * `api-types.test-d.ts`, which means a schema added to (or renamed in) the
 * spec fails the build until it is aliased here. Nothing else in the SDK
 * keeps that list honest.
 *
 * Generated types are never edited by hand - see `generated/api-types.ts`,
 * whose header says as much, and the `gen:api` check in CI that proves it.
 * This module is the hand-written layer *over* them.
 */

import type { components } from '../../generated/api-types';

/** Every schema name the spec declares, in the spec's own vocabulary. */
export type ApiSchemaName = keyof components['schemas'];

/**
 * Every schema in the spec, keyed by its spec name.
 *
 * Each member is the generated type verbatim, so this is a naming table and
 * not a re-declaration: nothing here can drift from `openapi.yaml` without
 * the generated file changing first.
 */
export interface ApiSchemas {
  ErrorResponse: components['schemas']['ErrorResponse'];
  SettlementReport: components['schemas']['SettlementReport'];
  SettlementReportResult: components['schemas']['SettlementReportResult'];
  PaymentRow: components['schemas']['PaymentRow'];
  SyncState: components['schemas']['SyncState'];
  PaymentsResponse: components['schemas']['PaymentsResponse'];
  RouteRevenue: components['schemas']['RouteRevenue'];
  VerifyRequest: components['schemas']['VerifyRequest'];
  CheckResult: components['schemas']['CheckResult'];
  VerifyResponse: components['schemas']['VerifyResponse'];
  SyncResult: components['schemas']['SyncResult'];
}

/** The error body every 4xx/5xx from the indexer carries: `{"error": "..."}`. */
export type ErrorResponse = ApiSchemas['ErrorResponse'];

/** The body POSTed to `/api/hook/settle` - a wire format, hence snake_cased. */
export type SettlementReport = ApiSchemas['SettlementReport'];

/** `/api/hook/settle`'s 200 body: whether the report was recorded or staged. */
export type SettlementReportResult = ApiSchemas['SettlementReportResult'];

/** One row of `/api/payments`. Money fields are decimal strings, never numbers. */
export type PaymentRow = ApiSchemas['PaymentRow'];

/** How far the indexer has synced, as returned alongside every page. */
export type SyncState = ApiSchemas['SyncState'];

/** One page of `/api/payments`, with its cursor and aggregate totals. */
export type PaymentsResponse = ApiSchemas['PaymentsResponse'];

/** One row of `/api/routes`: revenue attributed to a route and method. */
export type RouteRevenue = ApiSchemas['RouteRevenue'];

/** The body POSTed to `/api/verify`. */
export type VerifyRequest = ApiSchemas['VerifyRequest'];

/** One verification leg's outcome: `ok` is null when that leg never ran. */
export type CheckResult = ApiSchemas['CheckResult'];

/** `/api/verify`'s 200 body: the local and on-chain legs plus their verdict. */
export type VerifyResponse = ApiSchemas['VerifyResponse'];

/** A sync run's outcome, or the cooldown notice that replaced it. */
export type SyncResult = ApiSchemas['SyncResult'];

/**
 * The HTTP methods the indexer can attribute a settled payment to.
 *
 * Read off {@link SettlementReport} rather than restated, so the enum this
 * SDK validates against cannot drift from the one the spec publishes.
 */
export type SettlementMethod = SettlementReport['method'];
