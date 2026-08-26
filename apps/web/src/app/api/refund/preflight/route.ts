import { NextResponse } from 'next/server';
import {
  REFUND_VAULT_ID,
  getRefund,
  preflightRefund,
  type RefundPreflight,
  type RefundRecord,
} from '@/lib/refund-vault';
import { withClient } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';

export const dynamic = 'force-dynamic';

/**
 * Answers "would this refund go through, and has it already?" without signing.
 *
 * Runs server-side because the RPC endpoint is configured here and the reads
 * are simulations that need no wallet. The merchant's browser only signs once
 * this has already said yes, so a doomed refund never reaches a signing prompt.
 *
 * Read-only: nothing here submits a transaction or moves funds.
 */

export interface RefundPreflightRequest {
  txHash: string;
  recipient: string;
  /** Stroops, decimal string. */
  amount: string;
  paidAtLedger: number;
  merchant: string;
}

export interface RefundPreflightResponse {
  contract: string;
  /** Set when this payment has already been refunded. */
  existing: RefundRecord | null;
  preflight: RefundPreflight;
}

export async function POST(request: Request) {
  let body: RefundPreflightRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  const { txHash, recipient, amount, paidAtLedger, merchant } = body ?? {};

  if (typeof txHash !== 'string' || typeof recipient !== 'string' || typeof merchant !== 'string') {
    return NextResponse.json(
      { error: 'txHash, recipient, and merchant are required' },
      { status: 400 },
    );
  }
  // Amount stays a string end to end. Accepting a number here would put the
  // refund through a float on its way to an i128.
  if (typeof amount !== 'string' || !/^\d+$/.test(amount) || amount === '0') {
    return NextResponse.json(
      { error: 'amount must be a positive integer string in stroops' },
      { status: 400 },
    );
  }
  if (!Number.isInteger(paidAtLedger) || paidAtLedger < 0) {
    return NextResponse.json({ error: 'paidAtLedger must be a ledger number' }, { status: 400 });
  }

  const caller = await withClient((client) => getMerchantFromRequest(client, request));
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const vaultId = caller.refundVaultId ?? REFUND_VAULT_ID;

  let existing: RefundRecord | null = null;
  try {
    existing = await getRefund(txHash, merchant, vaultId);
  } catch {
    // A failed lookup is not evidence the payment was never refunded, so it is
    // left null and the preflight below still runs — the contract itself will
    // report AlreadyRefunded if that is the case.
  }

  const preflight = await preflightRefund({
    txHash,
    recipient,
    amount,
    paidAtLedger,
    merchant,
    vaultId,
  });

  return NextResponse.json<RefundPreflightResponse>({
    contract: vaultId,
    existing,
    preflight,
  });
}
