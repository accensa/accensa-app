import { describe, it, expect } from 'vitest';
import { isHash32 } from './receipt-anchor';
import { verifyReceipt } from '@accensa/sdk/merkle';
import vectors from '../../../../packages/sdk/merkle-vectors.json';

describe('isHash32', () => {
  it('accepts a 64-character hex string', () => {
    expect(isHash32('a'.repeat(64))).toBe(true);
    expect(isHash32('A'.repeat(64))).toBe(true);
  });

  it('tolerates surrounding whitespace from pasted input', () => {
    expect(isHash32(`  ${'a'.repeat(64)}\n`)).toBe(true);
  });

  it('rejects wrong lengths', () => {
    expect(isHash32('a'.repeat(63))).toBe(false);
    expect(isHash32('a'.repeat(65))).toBe(false);
    expect(isHash32('')).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isHash32('z'.repeat(64))).toBe(false);
    expect(isHash32(`0x${'a'.repeat(62)}`)).toBe(false);
  });
});

describe('verifier sample data', () => {
  // The /verify page ships a preloaded sample so anyone can see the verifier
  // work without first obtaining a receipt. If that sample drifts from the
  // conformance vectors, the front page of the product silently starts lying.
  const live = vectors.cases[0];
  const forged = vectors.cases[1];

  const SAMPLE_LEAF =
    'c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c';
  const SAMPLE_PROOF = [
    '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1',
    '1733fad16ada0c23d8cdaff52bea66bea308dddddcb79348842acef0065c9615',
  ];
  const FORGED_LEAF =
    '16b138aabc889c21114436424e13132bd8928d2c21b4ac5a9ac5198104efb42c';

  it('valid sample matches the anchored conformance vector', () => {
    expect(SAMPLE_LEAF).toBe(live.leaf);
    expect(SAMPLE_PROOF).toEqual(live.proof);
    expect(live.expected).toBe(true);
  });

  it('forged sample matches the negative conformance vector', () => {
    expect(FORGED_LEAF).toBe(forged.leaf);
    expect(forged.expected).toBe(false);
  });

  it('valid sample verifies locally against the on-chain root', () => {
    expect(verifyReceipt(SAMPLE_LEAF, SAMPLE_PROOF, vectors.onchain.root)).toBe(true);
  });

  it('forged sample fails locally against the on-chain root', () => {
    expect(verifyReceipt(FORGED_LEAF, SAMPLE_PROOF, vectors.onchain.root)).toBe(false);
  });

  it('pins the batch that the sample refers to', () => {
    expect(vectors.onchain.batchId).toBe(1);
    expect(vectors.onchain.contract).toBe(
      'CBHRJU7CF4XIFRNDITFHNQHABKBMFM2FYFHLGWN3JGSFYYCDSMDAWPRV',
    );
  });
});
