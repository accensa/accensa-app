/**
 * `@accensa/sdk/api` - the hand-written layer over the generated API types.
 *
 * `apps/web/openapi.yaml` documents the indexer's HTTP surface;
 * `pnpm --filter @accensa/sdk gen:api` turns it into
 * `packages/sdk/generated/api-types.ts`, and CI fails if that file is stale.
 * That covers generation, but not *consumption*: the generated file is
 * deliberately mechanical, so reaching into it means four-level index chains
 * and `never` guards at both ends.
 *
 * This folder is where those chains are unwound once:
 *
 * - `schema.ts` names every schema in the spec (`SettlementReport`,
 *   `PaymentsResponse`, ...) and keeps a machine-checked list of them.
 * - `operations.ts` names what every operation sends and returns, and derives
 *   the request/response/parameter types from `operationId` + status.
 * - the SDK's own wire types - `SettleHookPayload` above all - are defined as
 *   members of those lists, so a spec change reaches them instead of drifting.
 *
 * The type-level contract is asserted in `api-types.test-d.ts`; the runtime
 * behaviour it constrains is asserted in `api-types.test.ts`.
 */

export type {
  ApiSchemaName,
  ApiSchemas,
  CheckResult,
  ErrorResponse,
  PaymentRow,
  PaymentsResponse,
  RouteRevenue,
  SettlementMethod,
  SettlementReport,
  SettlementReportResult,
  SyncResult,
  SyncState,
  VerifyRequest,
  VerifyResponse,
} from './schema';

export type {
  ApiOperation,
  ApiOperationName,
  ApiOperationRequest,
  ApiOperationResponse,
  ApiPath,
  HeaderParams,
  HttpMethod,
  JsonRequestBody,
  JsonResponseBody,
  ListPaymentsQuery,
  ListPaymentsResponse,
  ListRouteRevenueResponse,
  QueryParams,
  RequestBodyOf,
  ResponseBodyOf,
  ResponseStatus,
  SettlementReportBody,
  SettlementReportResultBody,
  SyncResultBody,
  VerifyRequestBody,
  VerifyResponseBody,
} from './operations';
