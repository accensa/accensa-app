/**
 * End-to-end encryption primitives for the merchant support chat.
 *
 * No chat SDK is required: the key is derived from the merchant's Stellar
 * wallet address (the same identity the rest of the dashboard uses) and
 * messages are sealed with AES-256-GCM via the platform Web Crypto API.
 * Nothing but ciphertext ever reaches storage.
 */

/** PBKDF2 iteration count (OWASP recommendation for PBKDF2-HMAC-SHA256). */
export const PBKDF2_ITERATIONS = 310_000;

/** AES-GCM recommended nonce length in bytes. */
const IV_LENGTH = 12;

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Derives a 256-bit AES-GCM key from a wallet address and a per-session salt.
 *
 * Deterministic for a given (address, salt) pair, so the same merchant wallet
 * always unlocks the same conversation while a fresh salt keeps conversations
 * independent.
 */
export async function deriveKey(
  walletAddress: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(walletAddress),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface EncryptedPayload {
  /** Base64-encoded ciphertext. */
  ciphertext: string;
  /** Base64-encoded AES-GCM nonce. */
  iv: string;
}

export async function encryptPayload(
  key: CryptoKey,
  plaintext: string,
): Promise<EncryptedPayload> {
  const iv = randomBytes(IV_LENGTH);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv) };
}

export async function decryptPayload(
  key: CryptoKey,
  payload: EncryptedPayload,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(payload.iv) },
    key,
    fromBase64(payload.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
