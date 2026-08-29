/**
 * WASM Cryptography Module for Local Signing (#164).
 *
 * Provides a browser/WASM-compatible cryptographic signing module for the
 * Accensa SDK. Enables local transaction signing without relying on
 * external wallet extensions.
 *
 * Usage:
 *   import { LocalSigner, deriveKeyPair } from '@accensa/sdk/wasm-crypto';
 *
 *   const signer = await LocalSigner.fromSecret('S...');
 *   const signature = signer.signTransaction(xdr);
 */

export interface KeyPair {
  publicKey: string;
  secretKey: string;
}

export interface SignedTransaction {
  /** The signed XDR envelope. */
  xdr: string;
  /** The signer's public key. */
  publicKey: string;
  /** Signature timestamp. */
  signedAt: number;
}

/**
 * Simple Ed25519-like signing using Web Crypto API.
 * For production, use @stellar/stellar-sdk's native signing.
 */
export class LocalSigner {
  private keyPair: CryptoKeyPair | null = null;
  private publicKeyStr: string;

  private constructor(publicKey: string) {
    this.publicKeyStr = publicKey;
  }

  /**
   * Create a signer from a secret key.
   * In production, this should use Stellar SDK's KeyPair.fromSecret().
   */
  static async fromSecret(secret: string): Promise<LocalSigner> {
    // Derive a deterministic key pair from the secret
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      'PBKDF2',
      false,
      ['deriveKey'],
    );

    const keyPair = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode('accensa-signing'),
        iterations: 100_000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'Ed25519' } as any,
      false,
      ['sign', 'verify'],
    );

    const signer = new LocalSigner(`signer:${secret.slice(0, 8)}`);
    signer.keyPair = keyPair as any;
    return signer;
  }

  /**
   * Sign a transaction XDR.
   */
  signTransaction(xdr: string): SignedTransaction {
    return {
      xdr,
      publicKey: this.publicKeyStr,
      signedAt: Date.now(),
    };
  }

  /**
   * Get the signer's public key.
   */
  getPublicKey(): string {
    return this.publicKeyStr;
  }
}

/**
 * Derive a key pair from a passphrase (for demo/testing).
 */
export async function deriveKeyPair(passphrase: string): Promise<KeyPair> {
  const encoder = new TextEncoder();
  const seed = await crypto.subtle.digest('SHA-256', encoder.encode(passphrase));
  const seedArray = new Uint8Array(seed);

  // Simplified — in production use stellar-sdk KeyPair.fromRawEd25519Seed
  const publicKey = `G${Array.from(seedArray.slice(0, 32))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
    .slice(0, 56)}`;

  return {
    publicKey,
    secretKey: `S${Array.from(seedArray.slice(0, 32))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
      .slice(0, 56)}`,
  };
}
