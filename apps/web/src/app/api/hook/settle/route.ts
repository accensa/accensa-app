import { NextResponse } from 'next/server';
import { withClient, withMerchantClient, ensureSchema, recordSettlement } from '@/lib/db';
import { parseSettlementReport } from '@/lib/settlement-report';
import { listMerchants, type Merchant } from '@/lib/merchants';

export const dynamic = 'force-dynamic';

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
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const { matchedExistingPayment } = await withMerchantClient(merchant.id, async (client) => {
      await ensureSchema(client);
      return recordSettlement(client, merchant.id, parsed.report);
    });

    return NextResponse.json({
      recorded: true,
      txHash: parsed.report.txHash,
      // False means the transfer has not been indexed yet and the attribution
      // was staged. The sync job completes the row when it reaches that ledger.
      matchedExistingPayment,
    });
  } catch (error) {
    console.error('Error recording settlement:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
