/**
 * Ed25519 signing for settlement reports.
 *
 * Prefers WebCrypto, which works in browsers, edge runtimes and modern Node,
 * and falls back to `node:crypto` where WebCrypto lacks Ed25519.
 */

/** PKCS#8 wrapper for a raw 32-byte Ed25519 private seed (RFC 8410). */
const ED25519_PKCS8_PREFIX = '302e020100300506032b657004220420';

/** Wraps a hex-encoded 32-byte Ed25519 seed in a PKCS#8 DER envelope. */
export function privateKeyPkcs8(privateKeyHex: string): ArrayBuffer {
  if (!/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) {
    throw new Error('Ed25519 private key must be exactly 32 bytes encoded as hex');
  }
  const result = new Uint8Array(48);
  for (let i = 0; i < ED25519_PKCS8_PREFIX.length; i += 2) {
    result[i / 2] = Number.parseInt(ED25519_PKCS8_PREFIX.slice(i, i + 2), 16);
  }
  for (let i = 0; i < 32; i += 1) {
    result[16 + i] = Number.parseInt(privateKeyHex.slice(i * 2, i * 2 + 2), 16);
  }
  return result.buffer;
}

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The most recently imported WebCrypto signing key.
 *
 * Importing the key is roughly as expensive as signing with it, and a
 * merchant signs every report with the same key, so it is imported once and
 * reused. One entry keeps memory bounded however many keys a process rotates
 * through; a rollover just costs one fresh import. The entry is tied to the
 * `SubtleCrypto` that produced it, since a key from one implementation is
 * meaningless to another, and a failed import is never kept.
 */
let importedKey:
  { privateKeyHex: string; subtle: SubtleCrypto; key: Promise<CryptoKey> } | undefined;

function importSigningKey(subtle: SubtleCrypto, privateKeyHex: string): Promise<CryptoKey> {
  if (importedKey?.privateKeyHex === privateKeyHex && importedKey.subtle === subtle) {
    return importedKey.key;
  }
  const key = subtle.importKey(
    'pkcs8',
    privateKeyPkcs8(privateKeyHex),
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  const entry = { privateKeyHex, subtle, key };
  importedKey = entry;
  key.catch(() => {
    if (importedKey === entry) importedKey = undefined;
  });
  return key;
}

/** Signs `payload` with the given Ed25519 seed and returns the signature as hex. */
export async function signSettlementPayload(
  payload: string,
  privateKeyHex: string,
): Promise<string> {
  const data = encoder.encode(payload);
  // Validates the key up front, so a malformed one is reported as such rather
  // than as a missing crypto backend.
  const pkcs8 = privateKeyPkcs8(privateKeyHex);
  const subtle = globalThis.crypto?.subtle;

  if (subtle) {
    try {
      const key = await importSigningKey(subtle, privateKeyHex);
      const signature = await subtle.sign({ name: 'Ed25519' }, key, data);
      return toHex(new Uint8Array(signature));
    } catch {
      // Ed25519 is not available in every WebCrypto implementation; try Node below.
    }
  }

  try {
    const crypto = await import('node:crypto');
    const privateKey = crypto.createPrivateKey({
      key: Buffer.from(pkcs8),
      format: 'der',
      type: 'pkcs8',
    });
    return crypto.sign(null, Buffer.from(data), privateKey).toString('hex');
  } catch {
    throw new Error(
      'Ed25519 signing unavailable: WebCrypto Ed25519 support and Node.js crypto are missing',
    );
  }
}
