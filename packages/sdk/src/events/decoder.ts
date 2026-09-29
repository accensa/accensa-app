import { xdr, scValToNative, Address } from '@stellar/stellar-sdk';
import { fromStroops } from '../price-formatter';
import type {
  AccensaEvent,
  DepositEvent,
  RefundEvent,
  DisputeEvent,
  DisputeStatus,
  AnchorEvent,
  MultisigEvent,
  MultisigOperation,
  RawSorobanRpcEvent,
} from './types';

/** Error thrown when an event payload fails decoding or validation. */
export class EventDecodeError extends Error {
  readonly code: 'invalid_payload' | 'unrecognized_event' | 'missing_fields';
  readonly raw?: unknown;

  constructor(
    message: string,
    code: 'invalid_payload' | 'unrecognized_event' | 'missing_fields' = 'invalid_payload',
    raw?: unknown,
  ) {
    super(message);
    this.name = 'EventDecodeError';
    this.code = code;
    this.raw = raw;
  }
}

/** Converts an unknown value into a canonical Stellar address string. */
function toAddressString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object') {
    if (value instanceof Address) return value.toString();
    if ('toString' in value && typeof value.toString === 'function') {
      const str = value.toString();
      if (typeof str === 'string' && str.length > 0 && str !== '[object Object]') {
        return str;
      }
    }
  }
  return null;
}

/** Converts binary data (Uint8Array, Buffer, or hex string) into a lowercase hex string. */
function toHexString(value: unknown): string | null {
  if (typeof value === 'string') {
    const clean = value.startsWith('0x') ? value.slice(2) : value;
    if (/^[0-9a-fA-F]+$/.test(clean) && clean.length % 2 === 0) {
      return clean.toLowerCase();
    }
    return null;
  }
  if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))) {
    return Array.from(value)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return null;
}

/** Parses raw topic or value item from XDR or native representations. */
function parseScValNative(input: unknown): unknown {
  if (input === null || input === undefined) return null;
  if (input instanceof xdr.ScVal) {
    return scValToNative(input);
  }
  if (typeof input === 'string') {
    try {
      const parsedVal = xdr.ScVal.fromXDR(input, 'base64');
      return scValToNative(parsedVal);
    } catch {
      // If not base64 XDR, retain the raw string
      return input;
    }
  }
  if (
    typeof input === 'object' &&
    'xdr' in input &&
    typeof (input as { xdr: unknown }).xdr === 'string'
  ) {
    try {
      const parsedVal = xdr.ScVal.fromXDR((input as { xdr: string }).xdr, 'base64');
      return scValToNative(parsedVal);
    } catch {
      return input;
    }
  }
  return input;
}

/** Extracts BigInt stroops from raw decoded field. */
function extractBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.floor(value));
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    try {
      return BigInt(value.trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** Extracts integer number from raw decoded field. */
function extractNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'bigint') {
    const num = Number(value);
    return Number.isSafeInteger(num) ? num : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const num = Number(value.trim());
    return Number.isSafeInteger(num) ? num : null;
  }
  return null;
}

/**
 * Type guard for {@link DepositEvent}.
 */
export function isDepositEvent(event: AccensaEvent): event is DepositEvent {
  return event.type === 'deposit';
}

/**
 * Type guard for {@link RefundEvent}.
 */
export function isRefundEvent(event: AccensaEvent): event is RefundEvent {
  return event.type === 'refund';
}

/**
 * Type guard for {@link DisputeEvent}.
 */
export function isDisputeEvent(event: AccensaEvent): event is DisputeEvent {
  return event.type === 'dispute';
}

/**
 * Type guard for {@link AnchorEvent}.
 */
export function isAnchorEvent(event: AccensaEvent): event is AnchorEvent {
  return event.type === 'anchor';
}

/**
 * Type guard for {@link MultisigEvent}.
 */
export function isMultisigEvent(event: AccensaEvent): event is MultisigEvent {
  return event.type === 'multisig';
}

/**
 * Exhaustive pattern matcher for {@link AccensaEvent} union instances.
 */
export function matchAccensaEvent<R>(
  event: AccensaEvent,
  handlers: {
    deposit: (e: DepositEvent) => R;
    refund: (e: RefundEvent) => R;
    dispute: (e: DisputeEvent) => R;
    anchor: (e: AnchorEvent) => R;
    multisig: (e: MultisigEvent) => R;
  },
): R {
  switch (event.type) {
    case 'deposit':
      return handlers.deposit(event);
    case 'refund':
      return handlers.refund(event);
    case 'dispute':
      return handlers.dispute(event);
    case 'anchor':
      return handlers.anchor(event);
    case 'multisig':
      return handlers.multisig(event);
    default: {
      const _exhaustiveCheck: never = event;
      throw new Error(`Unhandled AccensaEvent type: ${JSON.stringify(_exhaustiveCheck)}`);
    }
  }
}

/** Decodes a DepositEvent from native topics and value payload. */
function decodeDeposit(
  base: { id?: string; contractId: string; txHash: string; ledger: number; ledgerClosedAt: string },
  topics: unknown[],
  val: unknown,
): DepositEvent | null {
  const data = (val && typeof val === 'object' ? val : {}) as Record<string, unknown>;

  const from = toAddressString(topics[1] ?? data.from ?? data.depositor);
  const vault = toAddressString(topics[2] ?? data.vault ?? base.contractId);
  const token =
    (typeof topics[3] === 'string' ? topics[3] : null) ??
    toAddressString(data.token ?? data.asset) ??
    'native';

  const rawAmount = typeof val === 'bigint' ? val : (data.amount ?? data.stroops ?? val);
  const amount = extractBigInt(rawAmount);

  if (!from || !vault || amount === null) return null;

  const rawDepositId = data.deposit_id ?? data.depositId ?? data.id;
  const depositId =
    typeof rawDepositId === 'bigint'
      ? Number.isSafeInteger(Number(rawDepositId))
        ? Number(rawDepositId)
        : rawDepositId.toString()
      : (rawDepositId as string | number | undefined);

  return {
    ...base,
    type: 'deposit',
    from,
    vault,
    token,
    amount,
    amountDecimal: fromStroops(amount),
    depositId,
  };
}

/** Decodes a RefundEvent from native topics and value payload. */
function decodeRefund(
  base: { id?: string; contractId: string; txHash: string; ledger: number; ledgerClosedAt: string },
  topics: unknown[],
  val: unknown,
): RefundEvent | null {
  const data = (val && typeof val === 'object' ? val : {}) as Record<string, unknown>;

  const from = toAddressString(topics[1] ?? data.from ?? data.vault ?? base.contractId);
  const to = toAddressString(topics[2] ?? data.to ?? data.recipient ?? data.buyer);
  const token =
    (typeof topics[3] === 'string' ? topics[3] : null) ??
    toAddressString(data.token ?? data.asset) ??
    'native';

  const rawAmount = typeof val === 'bigint' ? val : (data.amount ?? data.stroops ?? val);
  const amount = extractBigInt(rawAmount);

  if (!from || !to || amount === null) return null;

  return {
    ...base,
    type: 'refund',
    from,
    to,
    token,
    amount,
    amountDecimal: fromStroops(amount),
    paymentId: (data.payment_id ?? data.paymentId ?? data.order_id ?? data.orderId) as
      string | undefined,
    reason: (data.reason ?? data.memo) as string | undefined,
  };
}

/** Decodes a DisputeEvent from native topics and value payload. */
function decodeDispute(
  base: { id?: string; contractId: string; txHash: string; ledger: number; ledgerClosedAt: string },
  topics: unknown[],
  val: unknown,
): DisputeEvent | null {
  const data = (val && typeof val === 'object' ? val : {}) as Record<string, unknown>;

  const disputeIdRaw =
    topics[1] ?? data.dispute_id ?? data.disputeId ?? data.channel_id ?? data.channelId;
  const disputeId =
    typeof disputeIdRaw === 'string'
      ? disputeIdRaw
      : (toHexString(disputeIdRaw) ?? String(disputeIdRaw ?? ''));

  const claimant = toAddressString(topics[2] ?? data.claimant ?? data.initiator);
  const respondent = toAddressString(topics[3] ?? data.respondent ?? data.merchant);

  const rawStatus = String(data.status ?? topics[4] ?? 'initiated').toLowerCase();
  const status: DisputeStatus =
    rawStatus === 'challenged' ||
    rawStatus === 'resolved' ||
    rawStatus === 'expired' ||
    rawStatus === 'canceled'
      ? rawStatus
      : 'initiated';

  const amount = extractBigInt(data.amount ?? data.bond ?? (typeof val === 'bigint' ? val : null));
  const timeoutLedger = extractNumber(data.timeout_ledger ?? data.timeoutLedger ?? data.timeout);

  if (!disputeId || !claimant) return null;

  return {
    ...base,
    type: 'dispute',
    disputeId,
    claimant,
    respondent: respondent ?? undefined,
    amount: amount ?? undefined,
    amountDecimal: amount !== null ? fromStroops(amount) : undefined,
    status,
    timeoutLedger: timeoutLedger ?? undefined,
    reason: (data.reason ?? data.memo) as string | undefined,
  };
}

/** Decodes an AnchorEvent from native topics and value payload. */
function decodeAnchor(
  base: { id?: string; contractId: string; txHash: string; ledger: number; ledgerClosedAt: string },
  topics: unknown[],
  val: unknown,
): AnchorEvent | null {
  const data = (val && typeof val === 'object' ? val : {}) as Record<string, unknown>;

  const merchant = toAddressString(topics[1] ?? data.merchant) ?? base.contractId;
  const batchId = extractNumber(topics[2] ?? data.batch_id ?? data.batchId ?? data.id);
  const root = toHexString(data.root ?? data.merkle_root ?? topics[3]);
  const count = extractNumber(data.count ?? data.leaf_count);
  const periodStart = extractNumber(data.period_start ?? data.periodStart ?? data.window_start);
  const periodEnd = extractNumber(data.period_end ?? data.periodEnd ?? data.window_end);

  if (batchId === null || !root || count === null || periodStart === null || periodEnd === null) {
    return null;
  }

  return {
    ...base,
    type: 'anchor',
    merchant,
    batchId,
    root,
    count,
    periodStart,
    periodEnd,
  };
}

/** Decodes a MultisigEvent from native topics and value payload. */
function decodeMultisig(
  base: { id?: string; contractId: string; txHash: string; ledger: number; ledgerClosedAt: string },
  topics: unknown[],
  val: unknown,
): MultisigEvent | null {
  const data = (val && typeof val === 'object' ? val : {}) as Record<string, unknown>;

  const rawOp = String(topics[1] ?? data.operation ?? data.action ?? 'proposed').toLowerCase();
  const operation: MultisigOperation =
    rawOp === 'approved' || rawOp === 'executed' || rawOp === 'revoked' ? rawOp : 'proposed';

  const rawProposalId = topics[2] ?? data.proposal_id ?? data.proposalId ?? data.id;
  const proposalId =
    typeof rawProposalId === 'bigint'
      ? Number.isSafeInteger(Number(rawProposalId))
        ? Number(rawProposalId)
        : rawProposalId.toString()
      : typeof rawProposalId === 'number' || typeof rawProposalId === 'string'
        ? rawProposalId
        : String(rawProposalId ?? '');

  const signer = toAddressString(topics[3] ?? data.signer ?? data.approver);

  const rawSigners = data.signers ?? data.approvers;
  const signers = Array.isArray(rawSigners)
    ? rawSigners.map(toAddressString).filter((s): s is string => Boolean(s))
    : undefined;

  const threshold = extractNumber(data.threshold);
  const target = toAddressString(data.target ?? data.destination);

  if (!proposalId || !signer) return null;

  return {
    ...base,
    type: 'multisig',
    operation,
    proposalId,
    signer,
    signers,
    threshold: threshold ?? undefined,
    target: target ?? undefined,
  };
}

/**
 * Attempts to decode any raw Soroban RPC event into an {@link AccensaEvent}.
 * Returns null if the event is not a recognized or decodable Accensa contract event.
 */
export function tryDecodeAccensaEvent(rawEvent: unknown): AccensaEvent | null {
  if (!rawEvent || typeof rawEvent !== 'object') return null;

  const ev = rawEvent as RawSorobanRpcEvent;
  const contractId = ev.contractId ?? '';
  const txHash = ev.txHash ?? '';
  const ledger = ev.ledger ?? 0;
  const ledgerClosedAt = ev.ledgerClosedAt ?? '';
  const id = ev.id;

  const base = { id, contractId, txHash, ledger, ledgerClosedAt };

  const rawTopics = Array.isArray(ev.topic) ? ev.topic : [];
  if (rawTopics.length === 0) return null;

  const nativeTopics = rawTopics.map(parseScValNative);
  const nativeValue = parseScValNative(ev.value);

  const eventName = String(nativeTopics[0] ?? '').toLowerCase();

  switch (eventName) {
    case 'deposit':
      return decodeDeposit(base, nativeTopics, nativeValue);
    case 'refund':
      return decodeRefund(base, nativeTopics, nativeValue);
    case 'dispute':
      return decodeDispute(base, nativeTopics, nativeValue);
    case 'anchor':
    case 'batch_anchored':
      return decodeAnchor(base, nativeTopics, nativeValue);
    case 'multisig':
      return decodeMultisig(base, nativeTopics, nativeValue);
    default:
      return null;
  }
}

/**
 * Decodes a raw Soroban RPC event into a strongly-typed {@link AccensaEvent}.
 * Throws {@link EventDecodeError} if the event payload cannot be parsed or decoded.
 */
export function decodeAccensaEvent(rawEvent: unknown): AccensaEvent {
  if (!rawEvent || typeof rawEvent !== 'object') {
    throw new EventDecodeError(
      'Raw event payload must be a non-null object.',
      'invalid_payload',
      rawEvent,
    );
  }

  const decoded = tryDecodeAccensaEvent(rawEvent);
  if (!decoded) {
    const ev = rawEvent as RawSorobanRpcEvent;
    const rawTopics = Array.isArray(ev.topic) ? ev.topic : [];
    const firstTopic = rawTopics.length > 0 ? String(parseScValNative(rawTopics[0])) : 'none';
    throw new EventDecodeError(
      `Failed to decode event: unrecognized or malformed event topic "${firstTopic}".`,
      'unrecognized_event',
      rawEvent,
    );
  }

  return decoded;
}

/** Base64 XDR topic filter for deposit events. */
export function depositTopicFilter(): string {
  return xdr.ScVal.scvSymbol('deposit').toXDR('base64');
}

/** Base64 XDR topic filter for refund events. */
export function refundTopicFilter(): string {
  return xdr.ScVal.scvSymbol('refund').toXDR('base64');
}

/** Base64 XDR topic filter for dispute events. */
export function disputeTopicFilter(): string {
  return xdr.ScVal.scvSymbol('dispute').toXDR('base64');
}

/** Base64 XDR topic filter for anchor events. */
export function anchorTopicFilter(): string {
  return xdr.ScVal.scvSymbol('anchor').toXDR('base64');
}

/** Base64 XDR topic filter for multisig events. */
export function multisigTopicFilter(): string {
  return xdr.ScVal.scvSymbol('multisig').toXDR('base64');
}
