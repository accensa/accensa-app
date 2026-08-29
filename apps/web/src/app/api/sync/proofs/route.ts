import { NextResponse } from 'next/server';
import { withClient, ensureSchema } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';
import { ensureZkCommitmentsSchema, recordVerifiedCommitment } from '@/lib/zk-ledger';
import {
  ZK_PROOF_SCHEME,
  canonicalJson,
  sha256Hex,
  verifyOpeningProof,
  type OpeningProof,
} from '@accensa/sdk/zk-proof';

export const dynamic = 'force-dynamic';

/**
 * Zero-knowledge-verified state transitions (#173).
 *
 * The indexer's RPC sweep records on-chain truth about public transfers, but
 * merchants also need to report state transitions privately — transaction
 * volumes, routes, settlement details — without the indexer ever storing the
 * plaintext. This endpoint is the privacy-preserving ingestion path:
 *
 *   1. The SDK commits to the transition with `createCommitment`, keeps the
 *      blinding secret, and submits `{ commitment, proof }` here.
 *   2. The indexer verifies the opening proof (recomputing the commitment
 *      from the proof's payload + blinding). Verification happens entirely in
 *      memory — the plaintext payload never touches the database.
 *   3. Only the commitment and a one-way SHA-256 of the canonical payload are
 *      persisted (see migrations/005_zk_commitments.sql). A leaked table
 *      exposes nothing about the underlying data.
 *
 * The verifier is pluggable (`ZkVerifier` in @accensa/sdk/zk-proof): a future
 * migration to a real zk-SNARK circuit implements the same interface and this
 * route does not change.
 *
 * Protected by session authentication via middleware, resolving to exactly
 * the merchant that owns this dashboard session — a signed-in merchant can
 * only submit proofs for themselves.
 */
export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { commitment, proof } = (body ?? {}) as {
    commitment?: unknown;
    proof?: unknown;
  };
  if (typeof commitment !== 'string' || !/^[0-9a-f]{64}$/i.test(commitment)) {
    return NextResponse.json(
      { error: 'commitment must be a 64-character hex SHA-256 digest' },
      { status: 400 },
    );
  }
  if (!proof || typeof proof !== 'object') {
    return NextResponse.json({ error: 'proof is required' }, { status: 400 });
  }
  const opening = proof as OpeningProof;
  if (opening.scheme !== ZK_PROOF_SCHEME) {
    return NextResponse.json(
      { error: `unsupported proof scheme: ${String(opening.scheme)}` },
      { status: 400 },
    );
  }

  // Verify in memory before touching the database at all.
  const valid = await verifyOpeningProof(commitment, opening);
  if (!valid) {
    return NextResponse.json({ error: 'proof does not open the commitment' }, { status: 422 });
  }

  try {
    const result = await withClient(async (client) => {
      await ensureSchema(client);
      await ensureZkCommitmentsSchema(client);
      const merchant = await getMerchantFromRequest(client, request);
      if (!merchant) return null;
      // The payload hash is the only trace of the plaintext ever persisted.
      const payloadHash = await sha256Hex(canonicalJson(opening.payload));
      const { recorded } = await recordVerifiedCommitment(client, merchant.id, {
        commitment,
        payloadHash,
        scheme: opening.scheme,
      });
      return { address: merchant.address, recorded };
    });

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json(
      {
        success: true,
        merchant: result.address,
        commitment,
        // 201 for a new commitment, 200 for an already-recorded one — the
        // transition is accepted either way, it is simply idempotent.
        recorded: result.recorded,
      },
      { status: result.recorded ? 201 : 200 },
    );
  } catch {
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
