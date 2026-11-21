import { describe, expect, it } from 'vitest';
import { deriveKeyPair } from './wasm-crypto';

describe('deriveKeyPair (#765)', () => {
  it('is deterministic: same passphrase yields identical key pairs across repeated calls', async () => {
    const passphrase = 'accensa-stable-deterministic-passphrase-2026';
    const pair1 = await deriveKeyPair(passphrase);
    const pair2 = await deriveKeyPair(passphrase);

    expect(pair1).toEqual(pair2);
    expect(pair1.publicKey).toBe(pair2.publicKey);
    expect(pair1.secretKey).toBe(pair2.secretKey);
  });

  it('generates distinct keys for different passphrases', async () => {
    const pairA = await deriveKeyPair('passphrase-alpha-first-seed');
    const pairB = await deriveKeyPair('passphrase-beta-second-seed');

    expect(pairA.publicKey).not.toBe(pairB.publicKey);
    expect(pairA.secretKey).not.toBe(pairB.secretKey);
  });

  it('is sensitive to the entire input: altering a single character in a long passphrase changes both keys', async () => {
    const base = 'an-exceptionally-long-merchant-account-passphrase-with-high-entropy-source-';
    const pair1 = await deriveKeyPair(base + 'A');
    const pair2 = await deriveKeyPair(base + 'B');

    expect(pair1.publicKey).not.toBe(pair2.publicKey);
    expect(pair1.secretKey).not.toBe(pair2.secretKey);
  });

  it('pins the key slicing format: publicKey starts with G, secretKey with S, followed by 56 uppercase hex characters', async () => {
    const pair = await deriveKeyPair('format-verification-passphrase');

    expect(pair.publicKey).toMatch(/^G[0-9A-F]{56}$/);
    expect(pair.secretKey).toMatch(/^S[0-9A-F]{56}$/);
  });

  it('pins the exact KeyPair object shape', async () => {
    const pair = await deriveKeyPair('shape-verification-passphrase');
    expect(Object.keys(pair).sort()).toEqual(['publicKey', 'secretKey']);
  });

  it('deterministically handles ASCII and non-ASCII passphrases via TextEncoder', async () => {
    const asciiPassphrase = 'correct horse battery staple 1234';
    const nonAsciiPassphrase = 'mot de passe avec des accents français et des émojis 🔑✓🌟';

    const asciiPair1 = await deriveKeyPair(asciiPassphrase);
    const asciiPair2 = await deriveKeyPair(asciiPassphrase);
    expect(asciiPair1.publicKey).toBe(asciiPair2.publicKey);
    expect(asciiPair1.publicKey).toMatch(/^G[0-9A-F]{56}$/);

    const nonAsciiPair1 = await deriveKeyPair(nonAsciiPassphrase);
    const nonAsciiPair2 = await deriveKeyPair(nonAsciiPassphrase);
    expect(nonAsciiPair1.publicKey).toBe(nonAsciiPair2.publicKey);
    expect(nonAsciiPair1.publicKey).toMatch(/^G[0-9A-F]{56}$/);

    expect(asciiPair1.publicKey).not.toBe(nonAsciiPair1.publicKey);
  });
});
