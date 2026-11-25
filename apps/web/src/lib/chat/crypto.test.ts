import { beforeEach, describe, expect, it } from 'vitest';
import {
  decryptPayload,
  deriveKey,
  encryptPayload,
  fromBase64,
  randomBytes,
  toBase64,
} from './crypto';

describe('apps/web/src/lib/chat/crypto', () => {
  describe('randomBytes', () => {
    it('returns a Uint8Array of the requested length', () => {
      const empty = randomBytes(0);
      expect(empty).toBeInstanceOf(Uint8Array);
      expect(empty.length).toBe(0);

      const bytes16 = randomBytes(16);
      expect(bytes16).toBeInstanceOf(Uint8Array);
      expect(bytes16.length).toBe(16);

      const bytes32 = randomBytes(32);
      expect(bytes32).toBeInstanceOf(Uint8Array);
      expect(bytes32.length).toBe(32);
    });

    it('returns random distributions across invocations', () => {
      const a = randomBytes(32);
      const b = randomBytes(32);
      expect(a).not.toEqual(b);
      expect(a.some((byte) => byte !== 0)).toBe(true);
      expect(b.some((byte) => byte !== 0)).toBe(true);
    });
  });

  describe('toBase64 and fromBase64', () => {
    it('performs lossless roundtrip conversion across empty buffers', () => {
      const original = new Uint8Array(0);
      const encoded = toBase64(original);
      expect(encoded).toBe('');
      const decoded = fromBase64(encoded);
      expect(decoded).toEqual(original);
    });

    it('performs lossless roundtrip conversion across single-byte buffers', () => {
      for (const val of [0, 42, 127, 255]) {
        const original = new Uint8Array([val]);
        const encoded = toBase64(original);
        const decoded = fromBase64(encoded);
        expect(decoded).toEqual(original);
      }
    });

    it('performs lossless roundtrip conversion across multi-byte buffers', () => {
      const allBytes = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        allBytes[i] = i;
      }
      const encoded = toBase64(allBytes);
      const decoded = fromBase64(encoded);
      expect(decoded).toEqual(allBytes);
    });

    it('encodes correctly to standard base64', () => {
      const text = 'Hello, World!';
      const bytes = new TextEncoder().encode(text);
      expect(toBase64(bytes)).toBe(btoa(text));
    });
  });

  describe('deriveKey', () => {
    const testAddress1 = 'GB3D5455X67U5P6W4R737OHGNDR236W254Q5K7R3Q4C6K2L2B2J3X4Y5';
    const testAddress2 = 'GA2C5455X67U5P6W4R737OHGNDR236W254Q5K7R3Q4C6K2L2B2J3X4Y6';
    const testSalt1 = randomBytes(16);
    const testSalt2 = randomBytes(16);
    const fastIterations = 1000;

    it('produces valid CryptoKey with expected properties', async () => {
      const key = await deriveKey(testAddress1, testSalt1, fastIterations);
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.extractable).toBe(false);
      expect(key.algorithm.name).toBe('AES-GCM');
      expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
      expect(key.usages).toEqual(expect.arrayContaining(['encrypt', 'decrypt']));
    });

    it('produces identical keys deterministically for identical inputs', async () => {
      const key1 = await deriveKey(testAddress1, testSalt1, fastIterations);
      const key2 = await deriveKey(testAddress1, testSalt1, fastIterations);

      const plaintext = 'deterministic key verification payload';
      const encrypted = await encryptPayload(key1, plaintext);
      const decrypted = await decryptPayload(key2, encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('produces differing keys for differing addresses', async () => {
      const key1 = await deriveKey(testAddress1, testSalt1, fastIterations);
      const key2 = await deriveKey(testAddress2, testSalt1, fastIterations);

      const encrypted = await encryptPayload(key1, 'secret message');
      await expect(decryptPayload(key2, encrypted)).rejects.toThrow();
    });

    it('produces differing keys for differing salts', async () => {
      const key1 = await deriveKey(testAddress1, testSalt1, fastIterations);
      const key2 = await deriveKey(testAddress1, testSalt2, fastIterations);

      const encrypted = await encryptPayload(key1, 'secret message');
      await expect(decryptPayload(key2, encrypted)).rejects.toThrow();
    });
  });

  describe('encryptPayload and decryptPayload', () => {
    const fastIterations = 1000;
    let key: CryptoKey;

    beforeEach(async () => {
      key = await deriveKey(
        'GB3D5455X67U5P6W4R737OHGNDR236W254Q5K7R3Q4C6K2L2B2J3X4Y5',
        randomBytes(16),
        fastIterations,
      );
    });

    it('successfully roundtrips plain ASCII text', async () => {
      const plaintext = 'Simple ASCII test string 1234567890 !@#$%^&*()';
      const payload = await encryptPayload(key, plaintext);
      expect(payload.ciphertext).toBeTypeOf('string');
      expect(payload.iv).toBeTypeOf('string');
      expect(payload.ciphertext.length).toBeGreaterThan(0);
      expect(payload.iv.length).toBeGreaterThan(0);

      const decrypted = await decryptPayload(key, payload);
      expect(decrypted).toBe(plaintext);
    });

    it('successfully roundtrips empty string', async () => {
      const plaintext = '';
      const payload = await encryptPayload(key, plaintext);
      const decrypted = await decryptPayload(key, payload);
      expect(decrypted).toBe(plaintext);
    });

    it('successfully roundtrips multi-byte Unicode strings', async () => {
      const plaintext = '🔐 Support chat: こんにちは 世界! 🚀✨ — é, à, ç, ü, ñ';
      const payload = await encryptPayload(key, plaintext);
      const decrypted = await decryptPayload(key, payload);
      expect(decrypted).toBe(plaintext);
    });

    it('successfully roundtrips JSON text payloads', async () => {
      const jsonPayload = JSON.stringify({
        roomId: 'room-12345',
        sender: 'GB3D5455X67U5P6W4R737OHGNDR236W254Q5K7R3Q4C6K2L2B2J3X4Y5',
        message: 'Dispute filed regarding transaction tx_98765',
        timestamp: Date.now(),
        metadata: {
          tags: ['dispute', 'urgent'],
          nested: { flag: true, count: 42 },
        },
      });
      const payload = await encryptPayload(key, jsonPayload);
      const decrypted = await decryptPayload(key, payload);
      expect(decrypted).toBe(jsonPayload);
      expect(JSON.parse(decrypted)).toEqual(JSON.parse(jsonPayload));
    });

    it('generates a fresh IV for each encryption call', async () => {
      const plaintext = 'repeated message';
      const payload1 = await encryptPayload(key, plaintext);
      const payload2 = await encryptPayload(key, plaintext);

      expect(payload1.iv).not.toBe(payload2.iv);
      expect(payload1.ciphertext).not.toBe(payload2.ciphertext);

      expect(await decryptPayload(key, payload1)).toBe(plaintext);
      expect(await decryptPayload(key, payload2)).toBe(plaintext);
    });

    it('rejects with an error when ciphertext is tampered with', async () => {
      const plaintext = 'tamper testing';
      const payload = await encryptPayload(key, plaintext);

      const rawCiphertext = fromBase64(payload.ciphertext);
      rawCiphertext[0] ^= 0xff;
      const tamperedPayload = {
        ...payload,
        ciphertext: toBase64(rawCiphertext),
      };

      await expect(decryptPayload(key, tamperedPayload)).rejects.toThrow();
    });

    it('rejects with an error when IV is tampered with', async () => {
      const plaintext = 'tamper iv testing';
      const payload = await encryptPayload(key, plaintext);

      const rawIv = fromBase64(payload.iv);
      rawIv[0] ^= 0xff;
      const tamperedPayload = {
        ...payload,
        iv: toBase64(rawIv),
      };

      await expect(decryptPayload(key, tamperedPayload)).rejects.toThrow();
    });

    it('rejects when invalid base64 data is provided', async () => {
      await expect(
        decryptPayload(key, { ciphertext: 'invalid base64!!!', iv: toBase64(randomBytes(12)) }),
      ).rejects.toThrow();
    });
  });
});
