import { NextResponse } from 'next/server';
import {
  withClient,
  withMerchantClient,
  ensureSchema,
  recordSettlement,
  consumeSettlementNonce,
} from '@/lib/db';
import { parseSettlementReport, type SettlementWindowCode } from '@/lib/settlement-report';
import { listMerchants, type Merchant } from '@/lib/merchants';

export const dynamic = 'force-dynamic';

/**
 * Every way this endpoint can answer "this request is not acceptable" with a
 * stable, machine-readable token — the typed half of `{ error, code }`.
 *
 * `report_replayed` is added by this route; the two window codes come out of
 * `parseSettlementReport`, which validates the timestamp *inside* the signed
 * bytes (see settlement-report.ts).
 */
export type SettleRejectionCode = SettlementWindowCode | 'report_replayed';

/** Prose paired with each {@link SettleRejectionCode}; `code` is the contract. */
const REJECTION_TEXT: Record<SettleRejectionCode, string> = {
  report_too_old: 'Settlement report is outside the accepted window',
  report_future_dated: 'Settlement report is dated too far in the future',
  report_replayed: 'Settlement report signature has already been used',
};

/**
 * Rejects with a typed error body — `{ error, code }` at 401.
 *
 * All three codes are authentication-class failures, not malformed input: the
 * Ed25519 signature over these exact bytes verified, but the credentials the
 * request carries — its signed timestamp, its single-use-ness — do not hold
 * right now. A caller (or a test) branches on `code` rather than on prose.
 */
function rejected(code: SettleRejectionCode): NextResponse {
  return NextResponse.json({ error: REJECTION_TEXT[code], code }, { status: 401 });
}

/**
 * Finds which configured merchant signed this report.
 *
 * The wire payload carries no merchant identifier — changing it would break
 * every existing `@accensa/sdk` integration mid-flight. Instead, the
 * signature itself is the identity: each merchant's `public_key_hex` is tried
 * in turn, and whichever one verifies is who reported it. With a small number
 * of merchants per deployment this is cheap, and it means onboarding a new
 * merchant's settlement reporting needs no SDK or wire-format change, only a
 * new `merchants` row.
 */
async function verifyingMerchant(
  merchants: Merchant[],
  raw: string,
  signatureHex: string,
  keyId?: string | null,
): Promise<Merchant | null> {
  const crypto = await import('node:crypto');
  let signature: Buffer;
  try {
    signature = Buffer.from(signatureHex, 'hex');
  } catch {
    return null;
  }

  for (const merchant of merchants) {
    if (!merchant.publicKeyHex) continue;
    const publicKeys = merchant.publicKeyHex
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    for (const pubKeyHex of publicKeys) {
      try {
        const keyBuffer = Buffer.from(pubKeyHex, 'hex');
        const publicKey = crypto.createPublicKey({
          key: Buffer.concat([
            Buffer.from('302a300506032b6570032100', 'hex'), // SubjectPublicKeyInfo Ed25519 header
            keyBuffer,
          ]),
          format: 'der',
          type: 'spki',
        });
        if (crypto.verify(null, Buffer.from(raw, 'utf8'), publicKey, signature)) {
          if (keyId) {
            console.info(`[accensa] settlement reported with key id: ${keyId}`);
          } else if (publicKeys.length > 1) {
            const prefix = pubKeyHex.substring(0, 8);
            const msg = `[accensa] settlement reported with key: ${prefix}... (key rotation)`;
            console.info(msg);
          }
          return merchant;
        }
      } catch {
        // A malformed key for one merchant must not block checking the rest.
        continue;
      }
    }
  }
  return null;
}

/**
 * Records route attribution reported by an x402 seller.
 *
 * A SAC `transfer` event carries payer, amount, and asset — never the HTTP
 * route that was paid for. That mapping exists only in the seller's process, so
 * it has to be reported rather than indexed. This is consequently the only
 * write path into `payments` that is not derived from the ledger, which is why
 * it fails closed: unless some merchant's signing key verifies the report, the
 * endpoint refuses to accept anything at all.
 *
 * Ledger-owned fields (ledger, amount, asset, ts) are never written here.
 *
 * Two controls make a captured report useless to whoever captures it, both
 * documented by `apps/web/src/proxy.ts`'s comment about this path:
 *
 * 1. The signed `reported_at` must sit inside the accepted five-minute window
 *    (enforced in `parseSettlementReport`, surfaced here as a typed 401).
 *    The timestamp is part of the signed bytes, so a replay cannot refresh it.
 * 2. The signature itself is consumed as a single-use nonce, in the same
 *    database transaction as the attribution write — store-backed, so the
 *    claim outlives a process restart.
 */
export async function POST(request: Request) {
  const signature = request.headers.get('x-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing X-Signature header' }, { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: 'Request body must be text/json' }, { status: 400 });
  }

  const merchant = await withClient(async (client) => {
    await ensureSchema(client);
    const merchants = await listMerchants(client);
    return await verifyingMerchant(merchants, raw, signature, request.headers.get('x-key-id'));
  });

  if (!merchant) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  const parsed = parseSettlementReport(body);
  if (!parsed.ok) {
    // A timestamp-window failure is verification, not malformed input: the
    // signature over these bytes is valid, the signed time is not acceptable
    // now. It is surfaced as a typed 401 (matching the proxy comment's claim
    // of a five-minute bound); everything else stays a 400.
    if (parsed.code) return rejected(parsed.code);
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // The nonce is the signature itself: Ed25519 signs one exact byte
  // sequence, so "same signature as before" and "same signed body replayed"
  // are the same event. Normalized so a upper-case hex header cannot smuggle
  // a second claim past the primary key.
  const nonce = signature.trim().toLowerCase();

  try {
    const outcome = await withMerchantClient(merchant.id, async (client) => {
      await ensureSchema(client);
      // Consume the nonce and write attribution atomically: a replay fails
      // the claim and writes nothing, while a transient failure on the write
      // rolls the claim back so the SDK's own retry of the same signed body
      // is not mistaken for an attack.
      await client.query('BEGIN');
      try {
        const claimed = await consumeSettlementNonce(client, nonce, merchant.id);
        if (!claimed) {
          await client.query('ROLLBACK');
          return { replayed: true as const };
        }
        const result = await recordSettlement(client, merchant.id, parsed.report);
        await client.query('COMMIT');
        return { replayed: false as const, ...result };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    });

    if (outcome.replayed) return rejected('report_replayed');

    return NextResponse.json({
      recorded: true,
      txHash: parsed.report.txHash,
      // False means the transfer has not been indexed yet and the attribution
      // was staged. The sync job completes the row when it reaches that ledger.
      matchedExistingPayment: outcome.matchedExistingPayment,
    });
  } catch (error) {
    console.error('Error recording settlement:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
