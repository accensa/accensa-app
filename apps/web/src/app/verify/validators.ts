/** Strip optional 0x prefix and surrounding whitespace, returning lowercase hex. */
export function normalizeHex(input: string): string {
  return input.trim().replace(/^0x/i, '').toLowerCase();
}

/** A hex-encoded 32-byte hash is exactly 64 hex characters. */
export function isHex64(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(normalizeHex(value));
}

export interface FieldErrors {
  batchId?: string;
  leaf?: string;
  proof?: string;
}

export function validate(batchId: string, leaf: string, proof: string): FieldErrors {
  const errors: FieldErrors = {};

  if (!batchId.trim()) {
    errors.batchId = 'Batch ID is required.';
  } else if (!/^\d+$/.test(batchId.trim())) {
    errors.batchId = 'Batch ID must be a whole number.';
  }

  const trimmedLeaf = leaf.trim();
  if (!trimmedLeaf) {
    errors.leaf = 'Receipt hash is required.';
  } else if (!isHex64(trimmedLeaf)) {
    errors.leaf = 'Must be exactly 64 hex characters (a 32-byte hash).';
  }

  const siblings = proof
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (siblings.length === 0) {
    errors.proof = 'At least one sibling hash is required.';
  } else {
    for (let i = 0; i < siblings.length; i++) {
      if (!isHex64(siblings[i])) {
        errors.proof = `Sibling #${i + 1} is not a valid 64-character hex hash.`;
        break;
      }
    }
  }

  return errors;
}
