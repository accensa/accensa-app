// Independent decoder for Stellar Asset Contract `transfer` events.
//
// This is a *second, independent* implementation of the same decode this repo
// already has in apps/web/src/lib/stellar-events.ts. It deliberately does not
// import that file, or anything under apps/web. The whole point of this
// package is that its answer is derived from chain data by a separate code
// path, so that agreement between the two is actual evidence rather than a
// foregone conclusion. See README.md, "Why the decoder is duplicated".
//
// Only the on-chain facts are extracted here: tx hash, ledger, payer, amount,
// asset, and ledger close time. `route`, `method` and `request_id` are not
// decodable from a SAC transfer event at all - they are reported by the
// merchant, out of band - so this module has no notion of them. See
// trustBoundary.mjs.

import { xdr, scValToNative, Address } from '@stellar/stellar-sdk';

/** Stellar amounts are integers scaled to 7 decimal places (1 XLM = 10,000,000 stroops). */
export const STROOPS_PER_UNIT = 10_000_000n;

/**
 * Renders integer stroops as a fixed-point decimal string, using integer
 * arithmetic only. Money must never pass through a float or a JS `number`,
 * which cannot represent an i128 exactly.
 */
export function stroopsToAmount(stroops) {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = abs / STROOPS_PER_UNIT;
  const frac = (abs % STROOPS_PER_UNIT).toString().padStart(7, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

function scvalFromBase64(base64) {
  return scValToNative(xdr.ScVal.fromXDR(base64, 'base64'));
}

function addressToString(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Address) return value.toString();
  return null;
}

/**
 * Extracts the i128 transfer amount, in stroops, from a decoded event value.
 *
 * The SAC has shipped two shapes for the data payload across protocol
 * versions: a bare i128, and a map carrying `{ amount, to_muxed_id }` for
 * muxed-account routing. Both are handled; anything else yields null.
 */
function extractStroops(decodedValue) {
  if (typeof decodedValue === 'bigint') return decodedValue;
  if (typeof decodedValue === 'number') return BigInt(decodedValue);
  if (decodedValue && typeof decodedValue === 'object' && 'amount' in decodedValue) {
    const amount = decodedValue.amount;
    if (typeof amount === 'bigint') return amount;
    if (typeof amount === 'number') return BigInt(amount);
  }
  return null;
}

/**
 * Decodes one raw Soroban RPC `getEvents` entry into a ledger-observed
 * transfer, or returns null when the event is not a decodable SAC transfer.
 *
 * A null return must never throw and must never abort a batch - a single
 * malformed or unrelated event is expected traffic (contracts emit lots of
 * events that are not this one), not a fault.
 *
 * @param {{
 *   txHash?: string, ledger?: number, ledgerClosedAt?: string,
 *   topic?: string[], value?: string | { xdr?: string }
 * }} event
 * @returns {{
 *   txHash: string, ledger: number, ledgerClosedAt: string,
 *   payer: string, to: string, asset: string, amount: string, stroops: bigint
 * } | null}
 */
export function decodeTransferEvent(event) {
  const topics = event.topic ?? [];
  if (topics.length < 3) return null;

  let symbolName;
  let fromRaw;
  let toRaw;
  let assetRaw;
  try {
    symbolName = scvalFromBase64(topics[0]);
    fromRaw = scvalFromBase64(topics[1]);
    toRaw = scvalFromBase64(topics[2]);
    if (topics[3] !== undefined) assetRaw = scvalFromBase64(topics[3]);
  } catch {
    return null;
  }
  if (symbolName !== 'transfer') return null;

  const payer = addressToString(fromRaw);
  const to = addressToString(toRaw);
  if (!payer || !to) return null;

  const rawValue = typeof event.value === 'string' ? event.value : event.value?.xdr;
  if (!rawValue) return null;

  let decodedValue;
  try {
    decodedValue = scvalFromBase64(rawValue);
  } catch {
    return null;
  }

  const stroops = extractStroops(decodedValue);
  if (stroops === null) return null;

  return {
    txHash: event.txHash ?? '',
    ledger: event.ledger ?? 0,
    ledgerClosedAt: event.ledgerClosedAt ?? '',
    payer,
    to,
    asset: typeof assetRaw === 'string' ? assetRaw : 'native',
    stroops,
    amount: stroopsToAmount(stroops),
  };
}
