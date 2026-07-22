import { xdr, scValToNative, Address } from '@stellar/stellar-sdk';

/** Stellar amounts are integers scaled to 7 decimal places. */
export const STROOPS_PER_UNIT = 10_000_000n;

/** A decoded Stellar Asset Contract `transfer` event. */
export interface TransferEvent {
  txHash: string;
  ledger: number;
  ledgerClosedAt: string;
  from: string;
  to: string;
  /** SEP-11 asset identifier, e.g. "native" or "USDC:GA...". */
  asset: string;
  /** Raw i128 amount in stroops. Never lossy. */
  stroops: bigint;
  /** Decimal string with 7 places. Kept as a string so it never becomes a float. */
  amount: string;
}

/** Raw event as returned by Soroban RPC `getEvents`. */
export interface RawEvent {
  txHash?: string;
  ledger?: number;
  ledgerClosedAt?: string;
  contractId?: string;
  topic?: string[];
  value?: string | { xdr?: string };
}

/** Base64 XDR of the `transfer` symbol, for use as an RPC topic filter. */
export function transferTopicFilter(): string {
  return xdr.ScVal.scvSymbol('transfer').toXDR('base64');
}

/**
 * Base64 XDR of an account address, for matching the recipient topic.
 *
 * Filtering server-side means the RPC only returns transfers to this merchant,
 * instead of every transfer of the asset.
 */
export function addressTopicFilter(address: string): string {
  return new Address(address).toScVal().toXDR('base64');
}

/**
 * Formats stroops as a fixed-point decimal string.
 *
 * Done with integer arithmetic rather than division so no precision is lost.
 * Money must never pass through a float.
 */
export function stroopsToDecimal(stroops: bigint): string {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = abs / STROOPS_PER_UNIT;
  const frac = abs % STROOPS_PER_UNIT;
  const fracStr = frac.toString().padStart(7, '0');
  return `${negative ? '-' : ''}${whole}.${fracStr}`;
}

function toAddressString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value instanceof Address) return value.toString();
  return null;
}

/**
 * Decodes a Stellar Asset Contract `transfer` event.
 *
 * The SAC emits topics `[Symbol("transfer"), Address(from), Address(to)]`, with
 * the asset appended as a fourth topic on most builds, and the i128 amount as
 * the event data. Some protocol versions instead carry `{amount, to_muxed_id}`
 * as a map in the data, so both shapes are handled.
 *
 * Returns null for events that are not decodable transfers, rather than
 * throwing, so one malformed event cannot stall an entire sync batch.
 */
export function decodeTransferEvent(event: RawEvent): TransferEvent | null {
  const topics = event.topic ?? [];
  if (topics.length < 3) return null;

  let name: unknown;
  let from: unknown;
  let to: unknown;
  let assetTopic: unknown;

  try {
    name = scValToNative(xdr.ScVal.fromXDR(topics[0], 'base64'));
    from = scValToNative(xdr.ScVal.fromXDR(topics[1], 'base64'));
    to = scValToNative(xdr.ScVal.fromXDR(topics[2], 'base64'));
    if (topics[3]) assetTopic = scValToNative(xdr.ScVal.fromXDR(topics[3], 'base64'));
  } catch {
    return null;
  }

  if (name !== 'transfer') return null;

  const fromStr = toAddressString(from);
  const toStr = toAddressString(to);
  if (!fromStr || !toStr) return null;

  const rawValue = typeof event.value === 'string' ? event.value : event.value?.xdr;
  if (!rawValue) return null;

  let decodedValue: unknown;
  try {
    decodedValue = scValToNative(xdr.ScVal.fromXDR(rawValue, 'base64'));
  } catch {
    return null;
  }

  // Either a bare i128, or a map carrying the amount alongside muxed routing info.
  let stroops: bigint | null = null;
  if (typeof decodedValue === 'bigint') {
    stroops = decodedValue;
  } else if (typeof decodedValue === 'number') {
    stroops = BigInt(decodedValue);
  } else if (decodedValue && typeof decodedValue === 'object') {
    const amount = (decodedValue as Record<string, unknown>).amount;
    if (typeof amount === 'bigint') stroops = amount;
    else if (typeof amount === 'number') stroops = BigInt(amount);
  }
  if (stroops === null) return null;

  return {
    txHash: event.txHash ?? '',
    ledger: event.ledger ?? 0,
    ledgerClosedAt: event.ledgerClosedAt ?? '',
    from: fromStr,
    to: toStr,
    asset: typeof assetTopic === 'string' ? assetTopic : 'native',
    stroops,
    amount: stroopsToDecimal(stroops),
  };
}
