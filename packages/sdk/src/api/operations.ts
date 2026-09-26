/**
 * Typed access to the operations in the Accensa indexer OpenAPI spec.
 *
 * `generated/api-types.ts` describes every route as a hand-unwound structure
 * (`paths[path][method] -> operations[id]`), and every consumer that wants
 * "the body of this route's POST" has to write the whole chain by hand, four
 * levels deep, with a `never` branch at each end. That is the complexity this
 * module exists to remove:
 *
 * ```ts
 * // before: four index levels, a `never` to guard, and a reader has to know
 * // the spec's exact nesting to review the line.
 * type Body = Extract<
 *   operations['reportSettlement']['requestBody'],
 *   { content: { 'application/json': infer B } }
 > >['content']['application/json'];
 *
 * // after
 * type Body = RequestBodyOf<'reportSettlement'>;
 * ```
 *
 * The generic extractors below do that unwinding once. On top of them, two
 * manifests - {@link ApiOperationRequest} and {@link ApiOperationResponse} -
 * list what every documented operation sends and returns, keyed by
 * `operationId`. Their key sets are asserted to equal the spec's in
 * `api-types.test-d.ts`, so a new operation cannot be added to the spec
 * without appearing here, and the SDK's public wire types
 * (`SettleHookPayload` and friends, in `../settle-report.ts`) are *defined*
 * as members of those manifests rather than transcribed from them.
 *
 * See `schema.ts` for the equivalent treatment of the spec's schemas, and
 * `generated/api-types.ts` for the rule that generated code is never edited
 * by hand.
 */

import type { operations, paths } from '../../generated/api-types';

/** Every `operationId` the spec declares. */
export type ApiOperationName = keyof operations;

/** Every path the spec declares, e.g. `/api/hook/settle`. */
export type ApiPath = keyof paths;

/**
 * Every HTTP method key a path entry can carry, in the spec's lowercase
 * spelling.
 *
 * Derived from a real path entry rather than written out, so it cannot fall
 * behind the spec. `/api/payments` is the exemplar because the spec declares
 * all eight method keys on every path, with `never` for the ones not served.
 */
export type HttpMethod = Exclude<keyof paths['/api/payments'], 'parameters'>;

/**
 * The operation behind one path and method, or `undefined` when that path
 * does not serve that method.
 *
 * ```ts
 * type Settle = ApiOperation<'/api/hook/settle', 'post'>; // operations['reportSettlement']
 * type None   = ApiOperation<'/api/routes', 'post'>;      // undefined
 * ```
 */
export type ApiOperation<Path extends ApiPath, Method extends HttpMethod> = paths[Path][Method];

/** The `responses` block of an operation, or `never` for something that is not one. */
type ResponsesOf<Op> = Op extends { responses: infer R } ? R : never;

/**
 * Collapses "the spec declares nothing here" to `undefined`.
 *
 * The spec writes an absent parameter as `query?: never`, which reads as
 * `undefined`; a shape the generators can also produce as a plain `never`.
 * Both mean the same thing to a caller, and neither is something they should
 * have to defend against, so both become `undefined`. A present body keeps its
 * own type, minus the `undefined` the spec's `?` contributes.
 */
type Present<T> = [T] extends [never]
  ? undefined
  : [T] extends [undefined]
    ? undefined
    : Exclude<T, undefined>;

/**
 * The JSON body of a content block, or `undefined` when the block declares no
 * JSON. `undefined` rather than `never` because "this response has no
 * documented body" is a fact a caller can act on - do not read one - not a
 * type error waiting to happen three properties away.
 */
type JsonContentOf<Block> = Block extends { content?: infer C }
  ? C extends { 'application/json': infer B }
    ? B
    : undefined
  : undefined;

/** Every response status an operation documents. */
export type ResponseStatus<Name extends ApiOperationName> = keyof ResponsesOf<operations[Name]>;

/**
 * The JSON request body of one operation, or `undefined` when it takes none
 * (every GET in the spec).
 */
export type JsonRequestBody<Name extends ApiOperationName> = JsonContentOf<
  operations[Name] extends { requestBody?: infer B } ? B : never
>;

/** The JSON body of one response status of one operation. */
export type JsonResponseBody<
  Name extends ApiOperationName,
  Status extends ResponseStatus<Name>,
> = JsonContentOf<ResponsesOf<operations[Name]>[Status]>;

/** The query parameters one operation accepts, or `undefined` when it takes none. */
export type QueryParams<Name extends ApiOperationName> = Present<
  operations[Name]['parameters'] extends { query?: infer Q } ? Q : never
>;

/** The header parameters one operation requires, or `undefined` when it takes none. */
export type HeaderParams<Name extends ApiOperationName> = Present<
  operations[Name]['parameters'] extends { header?: infer H } ? H : never
>;

/** Shorthand for {@link JsonRequestBody}, matching the spec's own vocabulary. */
export type RequestBodyOf<Name extends ApiOperationName> = JsonRequestBody<Name>;

/** Shorthand for {@link JsonResponseBody}. */
export type ResponseBodyOf<
  Name extends ApiOperationName,
  Status extends ResponseStatus<Name>,
> = JsonResponseBody<Name, Status>;

/**
 * What every documented operation sends, keyed by `operationId`.
 *
 * `undefined` marks an operation with no request body, which is the case for
 * the spec's three GETs.
 */
export interface ApiOperationRequest {
  reportSettlement: RequestBodyOf<'reportSettlement'>;
  listPayments: RequestBodyOf<'listPayments'>;
  listRouteRevenue: RequestBodyOf<'listRouteRevenue'>;
  verifyReceipt: RequestBodyOf<'verifyReceipt'>;
  runScheduledSync: RequestBodyOf<'runScheduledSync'>;
  runManualSync: RequestBodyOf<'runManualSync'>;
}

/**
 * What every documented operation returns on success (HTTP 200), keyed by
 * `operationId`.
 */
export interface ApiOperationResponse {
  reportSettlement: ResponseBodyOf<'reportSettlement', 200>;
  listPayments: ResponseBodyOf<'listPayments', 200>;
  listRouteRevenue: ResponseBodyOf<'listRouteRevenue', 200>;
  verifyReceipt: ResponseBodyOf<'verifyReceipt', 200>;
  runScheduledSync: ResponseBodyOf<'runScheduledSync', 200>;
  runManualSync: ResponseBodyOf<'runManualSync', 200>;
}

/**
 * `/api/hook/settle`'s request body, as an alias of the generated type.
 *
 * Named here so the settle contract in `../settle-report.ts` reads as a
 * lookup rather than a transcription, and so changing the spec's body changes
 * what the SDK POSTs instead of drifting away from it silently.
 */
export type SettlementReportBody = ApiOperationRequest['reportSettlement'];

/** `/api/hook/settle`'s 200 body. */
export type SettlementReportResultBody = ApiOperationResponse['reportSettlement'];

/** `/api/payments`' query parameters: paging, filters, and the active date range. */
export type ListPaymentsQuery = QueryParams<'listPayments'>;

/** `/api/payments`' 200 body: one page of rows plus the sync state. */
export type ListPaymentsResponse = ApiOperationResponse['listPayments'];

/** `/api/routes`' 200 body: revenue grouped by route and method. */
export type ListRouteRevenueResponse = ApiOperationResponse['listRouteRevenue'];

/** `/api/verify`'s request body. */
export type VerifyRequestBody = ApiOperationRequest['verifyReceipt'];

/** `/api/verify`'s 200 body. */
export type VerifyResponseBody = ApiOperationResponse['verifyReceipt'];

/**
 * Either sync entry point's 200 body.
 *
 * `/api/sync` is documented as two operations over one implementation - the
 * scheduled GET and the dashboard's POST - and the spec gives them the same
 * response, so one alias covers both.
 */
export type SyncResultBody =
  ApiOperationResponse['runScheduledSync'] | ApiOperationResponse['runManualSync'];
