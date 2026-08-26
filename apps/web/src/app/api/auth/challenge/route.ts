import { NextResponse } from 'next/server';
import { TransactionBuilder, Account, Operation, Networks } from '@stellar/stellar-sdk';
import { randomBytes } from 'crypto';
import { withClient, ensureSchema, storeNonce, sweepExpiredNonces } from '@/lib/db';
import { getMerchantByAddress } from '@/lib/merchants';

export const dynamic = 'force-dynamic';

function networkPassphrase(): string {
  return process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
}

/**
 * Which merchant is logging in has to be named up front: the challenge
 * transaction's source account *is* the merchant address, so it must be known
 * before the transaction is built and signed. `/api/auth/verify` then simply
 * reads it back out of the signed XDR — no second round of merchant lookup
 * logic to keep in sync.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');
  if (!address) {
    return NextResponse.json({ error: 'address query parameter is required' }, { status: 400 });
  }

  const merchant = await withClient(async (client) => {
    await ensureSchema(client);
    return getMerchantByAddress(client, address);
  });
  if (!merchant) {
    return NextResponse.json({ error: 'Unknown merchant' }, { status: 404 });
  }

  // Create a 64-byte random nonce
  const nonce = randomBytes(32).toString('hex');

  // Create a SEP-10 style challenge transaction
  // The source account is the merchant, sequence is 0
  const now = Math.floor(Date.now() / 1000);
  const passphrase = networkPassphrase();
  const tx = new TransactionBuilder(new Account(merchant.address, '0'), {
    fee: '100',
    networkPassphrase: passphrase,
    timebounds: { minTime: now - 60, maxTime: now + 300 },
  })
    .addOperation(
      Operation.manageData({
        name: 'Accensa Auth',
        value: nonce.substring(0, 64),
      }),
    )
    .build();

  // Persist the nonce so /api/auth/verify can confirm it was issued here
  // and has not already been used. Sweep expired nonces opportunistically.
  await withClient(async (client) => {
    await ensureSchema(client);
    await storeNonce(client, nonce, merchant.id);
    await sweepExpiredNonces(client);
  });

  return NextResponse.json({
    xdr: tx.toXDR(),
    networkPassphrase: passphrase,
  });
}
