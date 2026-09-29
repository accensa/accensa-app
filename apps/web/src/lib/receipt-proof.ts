/**
 * Receipt JSON parsing and signature checks for the public verifier (#446).
 *
 * Receipt format (all hashes and keys lowercase hex, `0x` optional):
 *
 *   {
 *     "batchId": 1,
 *     "leaf": "<32-byte receipt hash>",
 *     "proof": ["<32-byte sibling>", ...],
 *     "txHash": "<optional Stellar transaction hash>",
 *     "signatures": {
 *       "merchant": { "publicKey": "<32-byte Ed25519 key>", "signature": "<64-byte sig>" },
 *       "customer": { "publicKey": "...", "signature": "..." }
 *     }
 *   }
 *
 * Each signature is Ed25519 over the 32 raw bytes of `leaf`. The Merkle proof
 * itself is checked by `/api/verify` against the batch root anchored on-chain.
 */

export interface PartySignature {
  publicKey: string;
  signature: string;
}

export interface ParsedReceipt {
  batchId: number;
  leaf: string;
  proof: string[];
  txHash?: string;
  signatures: { merchant?: PartySignature; customer?: PartySignature };
}

export type ParseResult = { ok: true; receipt: ParsedReceipt } | { ok: false; error: string };

/** Upper bound on a dropped file; a receipt is well under a kilobyte per proof step. */
export const MAX_RECEIPT_BYTES = 256 * 1024;

const stripHex = (v: string) => v.trim().replace(/^0x/i, '').toLowerCase();
const isHex = (v: unknown, bytes: number): v is string =>
  typeof v === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(stripHex(v));

function parseParty(value: unknown, who: string): PartySignature | undefined | string {
  if (value === undefined) return undefined;
  const v = value as Record<string, unknown> | null;
  if (typeof v !== 'object' || v === null) return `signatures.${who} must be an object.`;
  if (!isHex(v.publicKey, 32)) return `signatures.${who}.publicKey must be a 32-byte hex key.`;
  if (!isHex(v.signature, 64))
    return `signatures.${who}.signature must be a 64-byte hex signature.`;
  return { publicKey: stripHex(v.publicKey), signature: stripHex(v.signature) };
}

export function parseReceiptJson(text: string): ParseResult {
  if (text.length > MAX_RECEIPT_BYTES) return { ok: false, error: 'Receipt file is too large.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Receipt must be a JSON object.' };
  }
  const r = raw as Record<string, unknown>;

  const batchId =
    typeof r.batchId === 'string' && /^\d+$/.test(r.batchId) ? Number(r.batchId) : r.batchId;
  if (typeof batchId !== 'number' || !Number.isSafeInteger(batchId) || batchId < 1) {
    return { ok: false, error: 'batchId must be a positive whole number.' };
  }
  if (!isHex(r.leaf, 32)) return { ok: false, error: 'leaf must be a 32-byte hex hash.' };
  if (!Array.isArray(r.proof) || r.proof.length === 0) {
    return { ok: false, error: 'proof must be a non-empty array of hex hashes.' };
  }
  for (let i = 0; i < r.proof.length; i++) {
    if (!isHex(r.proof[i], 32))
      return { ok: false, error: `proof[${i}] must be a 32-byte hex hash.` };
  }
  if (r.txHash !== undefined && !isHex(r.txHash, 32)) {
    return { ok: false, error: 'txHash must be a 32-byte hex hash.' };
  }

  const sigs = (r.signatures ?? {}) as Record<string, unknown>;
  const merchant = parseParty(sigs.merchant, 'merchant');
  if (typeof merchant === 'string') return { ok: false, error: merchant };
  const customer = parseParty(sigs.customer, 'customer');
  if (typeof customer === 'string') return { ok: false, error: customer };

  return {
    ok: true,
    receipt: {
      batchId,
      leaf: stripHex(r.leaf as string),
      proof: (r.proof as string[]).map(stripHex),
      txHash: r.txHash === undefined ? undefined : stripHex(r.txHash as string),
      signatures: { merchant, customer },
    },
  };
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export type SignatureStatus = 'valid' | 'invalid' | 'missing' | 'unsupported';

/**
 * Verifies one party's Ed25519 signature over the receipt leaf. Never throws:
 * a malformed key or a browser without WebCrypto Ed25519 is reported, not raised.
 */
export async function verifyPartySignature(
  leaf: string,
  party: PartySignature | undefined,
): Promise<SignatureStatus> {
  if (!party) return 'missing';
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return 'unsupported';
  try {
    const key = await subtle.importKey(
      'raw',
      fromHex(party.publicKey),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const ok = await subtle.verify(
      { name: 'Ed25519' },
      key,
      fromHex(party.signature),
      fromHex(leaf),
    );
    return ok ? 'valid' : 'invalid';
  } catch (error) {
    // Older engines reject the Ed25519 algorithm name; a bad key surfaces as a DataError.
    return error instanceof DOMException && error.name === 'DataError' ? 'invalid' : 'unsupported';
  }
}

export interface AuditBreakdown {
  merkleLocal: boolean | null;
  merkleOnChain: boolean | null;
  merchantSignature: SignatureStatus;
  customerSignature: SignatureStatus;
  /** Cryptographically verified: both Merkle checks pass and no present signature is invalid. */
  verified: boolean;
}

/**
 * Combines the server's Merkle verdicts with signature results. A missing
 * signature does not fail a receipt (the format makes them optional) but a
 * present-and-wrong or unverifiable one does.
 */
export function buildAudit(
  merkle: { local: boolean | null; onchain: boolean | null },
  merchantSignature: SignatureStatus,
  customerSignature: SignatureStatus,
): AuditBreakdown {
  const sigOk = (s: SignatureStatus) => s === 'valid' || s === 'missing';
  return {
    merkleLocal: merkle.local,
    merkleOnChain: merkle.onchain,
    merchantSignature,
    customerSignature,
    verified:
      merkle.local === true &&
      merkle.onchain === true &&
      sigOk(merchantSignature) &&
      sigOk(customerSignature),
  };
}
