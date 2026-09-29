/**
 * Type-level tests for the generated API types and the layer over them.
 *
 * `generated/api-types.ts` has no runtime behaviour to test - it is types all
 * the way down, which is exactly why it can rot unnoticed: nothing fails when
 * a schema is renamed or a new operation is added, the drift simply shows up
 * in a merchant's production. So the tests for it are *type* tests, and they
 * run in CI as part of `pnpm test`: `vitest.config.ts` enables Vitest's
 * `typecheck` mode over `**\/*.test-d.ts`, and a failed assertion fails the
 * build with a type error.
 *
 * The suite covers three things, in increasing order of how much damage the
 * corresponding drift would do:
 *
 *  1. **Coverage.** `ApiSchemas`, `ApiOperationRequest` and
 *     `ApiOperationResponse` are the hand-written lists of the spec's
 *     contents. Each is asserted to have exactly the spec's key set, so a
 *     schema or operation added to `openapi.yaml` cannot be left unaliased.
 *  2. **Identity.** `SettleHookPayload` is asserted to *be* the spec's
 *     `SettlementReport`, which is the whole point of routing it through
 *     `src/api/`: the body the SDK signs is the body the spec documents.
 *  3. **Extraction.** The generic extractors are asserted to resolve to the
 *     right body for a body-bearing operation, to `undefined` for the
 *     operations that take none, and to reject names the spec does not
 *     declare.
 *
 * `api-types.test.ts` is the runtime half: it asserts the behaviour the spec
 * constrains (which methods are accepted, what the wire body actually
 * contains) rather than the types behind it.
 */

import { expectTypeOf } from 'vitest';
import type { components, operations } from '../../generated/api-types';
import type { ApiSchemas } from './schema';
import type {
  ApiOperation,
  ApiOperationRequest,
  ApiOperationResponse,
  HeaderParams,
  HttpMethod,
  JsonRequestBody,
  JsonResponseBody,
  QueryParams,
  ResponseStatus,
  SettlementReportBody,
} from './operations';
import type { SettlementMethod, SettlementReport } from './schema';
import { SETTLE_METHODS, type SettleHookPayload } from '../settle-report';

/* -------------------------------------------------------------------------- */
/* 1. Coverage: the hand-written lists must have the spec's key sets.          */
/* -------------------------------------------------------------------------- */

expectTypeOf<keyof ApiSchemas>().toEqualTypeOf<keyof components['schemas']>();
expectTypeOf<keyof ApiOperationRequest>().toEqualTypeOf<keyof operations>();
expectTypeOf<keyof ApiOperationResponse>().toEqualTypeOf<keyof operations>();

/** Every schema the spec declares is reachable under a short name. */
expectTypeOf<ApiSchemas['SettlementReport']>().toEqualTypeOf<SettlementReport>();
expectTypeOf<ApiSchemas['ErrorResponse']>().toEqualTypeOf<{ error: string }>();

/* -------------------------------------------------------------------------- */
/* 2. Identity: the SDK's public wire types are the spec's, not copies of it.  */
/* -------------------------------------------------------------------------- */

expectTypeOf<SettleHookPayload>().toEqualTypeOf<components['schemas']['SettlementReport']>();
expectTypeOf<SettlementReportBody>().toEqualTypeOf<components['schemas']['SettlementReport']>();

/** The spec constrains `method` to seven verbs; the SDK's type says so too. */
expectTypeOf<SettleHookPayload['method']>().toEqualTypeOf<SettlementMethod>();
expectTypeOf<SettlementMethod>().toEqualTypeOf<
  'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
>();

/** And the runtime list is exactly that union - no missing verb, no extra. */
expectTypeOf<(typeof SETTLE_METHODS)[number]>().toEqualTypeOf<SettlementMethod>();

/** Money is a decimal string on the wire, never a number. */
expectTypeOf<SettleHookPayload['amount']>().toEqualTypeOf<string | null | undefined>();
expectTypeOf<NonNullable<SettleHookPayload['amount']>>().toBeString();

/** `tx_hash` and `route` are the two fields the indexer cannot do without. */
expectTypeOf<SettleHookPayload['tx_hash']>().toBeString();
expectTypeOf<SettleHookPayload['route']>().toBeString();

/* -------------------------------------------------------------------------- */
/* 3. Extraction: the generic helpers resolve to the spec's own types.         */
/* -------------------------------------------------------------------------- */

expectTypeOf<JsonRequestBody<'reportSettlement'>>().toEqualTypeOf<
  components['schemas']['SettlementReport']
>();
expectTypeOf<JsonResponseBody<'reportSettlement', 200>>().toEqualTypeOf<
  components['schemas']['SettlementReportResult']
>();
expectTypeOf<JsonResponseBody<'verifyReceipt', 200>>().toEqualTypeOf<
  components['schemas']['VerifyResponse']
>();
expectTypeOf<JsonResponseBody<'listPayments', 200>>().toEqualTypeOf<
  components['schemas']['PaymentsResponse']
>();

/** A response that documents no body resolves to `undefined`, not `never`. */
expectTypeOf<JsonResponseBody<'listPayments', 401>>().toBeUndefined();

/** Every GET in the spec takes no request body. */
expectTypeOf<JsonRequestBody<'listPayments'>>().toBeUndefined();
expectTypeOf<JsonRequestBody<'runManualSync'>>().toBeUndefined();

/** The status codes the spec documents for one operation. */
expectTypeOf<ResponseStatus<'reportSettlement'>>().toEqualTypeOf<200 | 400 | 401 | 503>();
expectTypeOf<ResponseStatus<'listRouteRevenue'>>().toEqualTypeOf<200 | 401>();

/** Parameters: `/api/hook/settle` is header-authenticated, `/api/payments` filtered. */
expectTypeOf<HeaderParams<'reportSettlement'>>().toHaveProperty('X-Signature');
expectTypeOf<QueryParams<'listPayments'>>().toHaveProperty('cursor');
expectTypeOf<QueryParams<'listRouteRevenue'>>().toHaveProperty('from');

/* -------------------------------------------------------------------------- */
/* Route and method lookup, derived from the spec rather than restated.        */
/* -------------------------------------------------------------------------- */

expectTypeOf<ApiOperation<'/api/hook/settle', 'post'>>().toEqualTypeOf<
  operations['reportSettlement']
>();
expectTypeOf<ApiOperation<'/api/payments', 'get'>>().toEqualTypeOf<operations['listPayments']>();
expectTypeOf<ApiOperation<'/api/routes', 'get'>>().toEqualTypeOf<operations['listRouteRevenue']>();

/** A path that does not serve a method resolves to `undefined`. */
expectTypeOf<ApiOperation<'/api/routes', 'post'>>().toBeUndefined();
expectTypeOf<ApiOperation<'/api/hook/settle', 'get'>>().toBeUndefined();

/** The eight method keys the spec's path entries carry, minus `parameters`. */
expectTypeOf<HttpMethod>().toEqualTypeOf<
  'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace'
>();

/* -------------------------------------------------------------------------- */
/* Negative assertions: names the spec does not declare must not compile.     */
/* -------------------------------------------------------------------------- */

// @ts-expect-error - `listInvoices` is not an operationId in openapi.yaml.
export type MissingOperation = JsonRequestBody<'listInvoices'>;

// @ts-expect-error - `/api/invoices` is not a path in openapi.yaml.
export type MissingPath = ApiOperation<'/api/invoices', 'get'>;

// @ts-expect-error - `reportSettlement` documents no 418 response.
export type MissingStatus = JsonResponseBody<'reportSettlement', 418>;

// @ts-expect-error - the spec's `SettlementReport.method` is a closed enum.
export const NOT_A_SETTLE_METHOD: SettlementMethod = 'TRACE';
