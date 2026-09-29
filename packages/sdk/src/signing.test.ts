import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import { privateKeyPkcs8, signSettlementPayload } from './signing';

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const der = privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
  return { seedHex: der.subarray(16).toString('hex'), der, publicKey };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('privateKeyPkcs8', () => {
  it('rebuilds the exact PKCS#8 DER node:crypto exports', () => {
    const { seedHex, der } = keyPair();
    expect(Buffer.from(privateKeyPkcs8(seedHex))).toEqual(der);
  });

  it.each([
    ['too short', 'ab'.repeat(31)],
    ['too long', 'ab'.repeat(33)],
    ['not hex', 'zz'.repeat(32)],
    ['empty', ''],
  ])('rejects a key that is %s', (_, hex) => {
    expect(() => privateKeyPkcs8(hex)).toThrow('exactly 32 bytes encoded as hex');
  });

  it('accepts uppercase hex', () => {
    const { seedHex, der } = keyPair();
    expect(Buffer.from(privateKeyPkcs8(seedHex.toUpperCase()))).toEqual(der);
  });
});

describe('signSettlementPayload', () => {
  it('produces a signature the matching public key verifies', async () => {
    const { seedHex, publicKey } = keyPair();
    const signature = await signSettlementPayload('{"a":1}', seedHex);
    expect(signature).toMatch(/^[0-9a-f]{128}$/);
    expect(verify(null, Buffer.from('{"a":1}'), publicKey, Buffer.from(signature, 'hex'))).toBe(
      true,
    );
  });

  it('falls back to node:crypto when WebCrypto lacks Ed25519', async () => {
    const { seedHex, publicKey } = keyPair();
    const importKey = vi.fn().mockRejectedValue(new Error('unsupported'));
    vi.stubGlobal('crypto', { subtle: { importKey } });

    const signature = await signSettlementPayload('payload', seedHex);

    expect(importKey).toHaveBeenCalledOnce();
    expect(verify(null, Buffer.from('payload'), publicKey, Buffer.from(signature, 'hex'))).toBe(
      true,
    );
  });

  it('rejects a malformed key before touching any crypto backend', async () => {
    const importKey = vi.fn();
    vi.stubGlobal('crypto', { subtle: { importKey } });
    await expect(signSettlementPayload('payload', 'nope')).rejects.toThrow('exactly 32 bytes');
    expect(importKey).not.toHaveBeenCalled();
  });

  describe('imported key reuse', () => {
    /** Real WebCrypto, with importKey counted. A fresh object per test also misses the cache. */
    function countingSubtle() {
      const real = globalThis.crypto.subtle;
      const importKey = vi.fn(real.importKey.bind(real)) as unknown as SubtleCrypto['importKey'];
      const subtle = { importKey, sign: real.sign.bind(real) };
      vi.stubGlobal('crypto', { subtle });
      return importKey as unknown as ReturnType<typeof vi.fn>;
    }

    it('imports a key once and reuses it for later signatures', async () => {
      const { seedHex, publicKey } = keyPair();
      const importKey = countingSubtle();

      const first = await signSettlementPayload('one', seedHex);
      const second = await signSettlementPayload('two', seedHex);

      expect(importKey).toHaveBeenCalledOnce();
      expect(verify(null, Buffer.from('one'), publicKey, Buffer.from(first, 'hex'))).toBe(true);
      expect(verify(null, Buffer.from('two'), publicKey, Buffer.from(second, 'hex'))).toBe(true);
    });

    it('re-imports when the key changes, and signs with the new one', async () => {
      const a = keyPair();
      const b = keyPair();
      const importKey = countingSubtle();

      await signSettlementPayload('p', a.seedHex);
      const signature = await signSettlementPayload('p', b.seedHex);

      expect(importKey).toHaveBeenCalledTimes(2);
      expect(verify(null, Buffer.from('p'), b.publicKey, Buffer.from(signature, 'hex'))).toBe(true);
    });

    it('does not reuse a key imported by a different WebCrypto implementation', async () => {
      const { seedHex } = keyPair();
      await signSettlementPayload('p', seedHex);

      const importKey = countingSubtle();
      await signSettlementPayload('p', seedHex);

      expect(importKey).toHaveBeenCalledOnce();
    });

    it('does not keep a failed import, so the next call tries again', async () => {
      const { seedHex, publicKey } = keyPair();
      const importKey = countingSubtle();
      importKey.mockRejectedValueOnce(new Error('transient'));

      // The first call still succeeds, through the node:crypto fallback.
      await signSettlementPayload('p', seedHex);
      const signature = await signSettlementPayload('p', seedHex);

      expect(importKey).toHaveBeenCalledTimes(2);
      expect(verify(null, Buffer.from('p'), publicKey, Buffer.from(signature, 'hex'))).toBe(true);
    });
  });
});
