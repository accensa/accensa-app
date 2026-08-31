import { describe, expect, it } from 'vitest';
import {
  decryptPayload,
  deriveKey,
  encryptPayload,
  fromBase64,
  randomBytes,
  toBase64,
} from './crypto';
import { createSession, loadSession, saveSession, type StorageLike } from './session';
import { SecureChatClient } from './secure-chat';

// PBKDF2 at 310k iterations is slow for tests; use a small count.
const FAST_ITERATIONS = 1_000;

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const WALLET_A = 'GBXPEXAMPLEWALLETA000000000000000000000000000000000000000000';
const WALLET_B = 'GBXPEXAMPLEWALLETB000000000000000000000000000000000000000000';

describe('chat crypto primitives', () => {
  it('base64 round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 128, 42]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it('derives a stable key from the same address and salt', async () => {
    const salt = randomBytes(16);
    const keyA = await deriveKey(WALLET_A, salt, FAST_ITERATIONS);
    const keyB = await deriveKey(WALLET_A, salt, FAST_ITERATIONS);
    // Keys are non-extractable; prove equivalence via a round-trip.
    const payload = await encryptPayload(keyA, 'hello');
    expect(await decryptPayload(keyB, payload)).toBe('hello');
  });

  it('derives different keys for different wallets with the same salt', async () => {
    const salt = randomBytes(16);
    const keyA = await deriveKey(WALLET_A, salt, FAST_ITERATIONS);
    const keyB = await deriveKey(WALLET_B, salt, FAST_ITERATIONS);
    const payload = await encryptPayload(keyA, 'secret');
    await expect(decryptPayload(keyB, payload)).rejects.toThrow();
  });

  it('derives different keys for the same wallet with different salts', async () => {
    const keyA = await deriveKey(WALLET_A, randomBytes(16), FAST_ITERATIONS);
    const keyB = await deriveKey(WALLET_A, randomBytes(16), FAST_ITERATIONS);
    const payload = await encryptPayload(keyA, 'secret');
    await expect(decryptPayload(keyB, payload)).rejects.toThrow();
  });

  it('encrypts to ciphertext that hides the plaintext', async () => {
    const key = await deriveKey(WALLET_A, randomBytes(16), FAST_ITERATIONS);
    const payload = await encryptPayload(key, 'a very secret message');
    expect(payload.ciphertext).not.toContain('secret');
    expect(payload.iv.length).toBeGreaterThan(0);
    expect(await decryptPayload(key, payload)).toBe('a very secret message');
  });

  it('rejects tampered ciphertext', async () => {
    const key = await deriveKey(WALLET_A, randomBytes(16), FAST_ITERATIONS);
    const payload = await encryptPayload(key, 'integrity matters');
    const bytes = fromBase64(payload.ciphertext);
    bytes[0] = bytes[0] ^ 0xff;
    await expect(
      decryptPayload(key, { ciphertext: toBase64(bytes), iv: payload.iv }),
    ).rejects.toThrow();
  });
});

describe('chat session storage', () => {
  it('creates a session bound to a wallet with a salt', () => {
    const session = createSession(WALLET_A);
    expect(session.merchantAddress).toBe(WALLET_A);
    expect(session.salt.length).toBeGreaterThan(0);
    expect(session.messages).toEqual([]);
  });

  it('round-trips through storage', () => {
    const storage = new MemoryStorage();
    const session = createSession(WALLET_A);
    session.messages.push({
      id: 'm1',
      role: 'merchant',
      createdAt: new Date().toISOString(),
      payload: { ciphertext: 'abc', iv: 'def' },
    });
    saveSession(storage, session);
    const loaded = loadSession(storage);
    expect(loaded?.merchantAddress).toBe(WALLET_A);
    expect(loaded?.messages).toHaveLength(1);
    expect(loaded?.messages[0].payload.ciphertext).toBe('abc');
  });

  it('returns null for missing or corrupt data', () => {
    const storage = new MemoryStorage();
    expect(loadSession(storage)).toBeNull();
    storage.setItem('accensa.support-chat.session', '{not json');
    expect(loadSession(storage)).toBeNull();
  });
});

describe('SecureChatClient', () => {
  it('unlocks a fresh session for a wallet and persists it', async () => {
    const storage = new MemoryStorage();
    const client = new SecureChatClient(storage, FAST_ITERATIONS);
    const result = await client.unlock(WALLET_A);
    expect(result.kind).toBe('unlocked');
    if (result.kind !== 'unlocked') return;
    expect(result.fresh).toBe(true);
    expect(client.merchantAddress).toBe(WALLET_A);
    expect(loadSession(storage)?.merchantAddress).toBe(WALLET_A);
  });

  it('re-locks to the same transcript for the same wallet', async () => {
    const storage = new MemoryStorage();
    const first = new SecureChatClient(storage, FAST_ITERATIONS);
    await first.unlock(WALLET_A);
    await first.send('hello buyer');
    await first.send('second message');

    const second = new SecureChatClient(storage, FAST_ITERATIONS);
    const result = await second.unlock(WALLET_A);
    expect(result.kind).toBe('unlocked');
    if (result.kind !== 'unlocked') return;
    expect(result.fresh).toBe(false);
    expect(second.messages).toHaveLength(2);
  });

  it('refuses to unlock a transcript created by a different wallet', async () => {
    const storage = new MemoryStorage();
    const first = new SecureChatClient(storage, FAST_ITERATIONS);
    await first.unlock(WALLET_A);
    await first.send('private');

    const other = new SecureChatClient(storage, FAST_ITERATIONS);
    const result = await other.unlock(WALLET_B);
    expect(result).toEqual({ kind: 'locked', reason: 'different-wallet' });
  });

  it('encrypts messages so storage never holds plaintext', async () => {
    const storage = new MemoryStorage();
    const client = new SecureChatClient(storage, FAST_ITERATIONS);
    await client.unlock(WALLET_A);
    const message = await client.send('this is top secret');
    expect(message.payload.ciphertext).not.toContain('top secret');
    expect(await client.read(message)).toBe('this is top secret');
  });

  it('throws on empty messages', async () => {
    const storage = new MemoryStorage();
    const client = new SecureChatClient(storage, FAST_ITERATIONS);
    await client.unlock(WALLET_A);
    await expect(client.send('   ')).rejects.toThrow('empty');
  });

  it('throws when used before unlocking', async () => {
    const client = new SecureChatClient(new MemoryStorage());
    await expect(client.send('hello')).rejects.toThrow('not unlocked');
  });

  it('reset wipes the transcript and the stored session', async () => {
    const storage = new MemoryStorage();
    const client = new SecureChatClient(storage, FAST_ITERATIONS);
    await client.unlock(WALLET_A);
    await client.send('hello');
    client.reset();
    expect(client.isUnlocked).toBe(false);
    expect(loadSession(storage)).toBeNull();

    const again = new SecureChatClient(storage, FAST_ITERATIONS);
    const result = await again.unlock(WALLET_A);
    expect(result.kind).toBe('unlocked');
    if (result.kind !== 'unlocked') return;
    expect(result.fresh).toBe(true);
  });
});
