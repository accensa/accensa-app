/**
 * Parity test: src/lib.rs and vectors.rs must each match merkle-vectors.json,
 * case for case and in order (name, leaf, proof entries, root, expected).
 *
 * CI diffs only the JSON against vectors.rs, so src/lib.rs can drift unseen.
 * This test covers the blind spot.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PKG_DIR = resolve(import.meta.dirname, '..');

interface JsonVector {
  name: string;
  leaf: string;
  proof: string[];
  root: string;
  expected: boolean;
}

interface ParsedVector {
  name: string;
  leaf: string;
  proof: string[];
  root: string;
  expected: boolean;
}

/** Convert a Rust byte-array literal `[0xAA, 0xBB, ...]` to a `0x`-prefixed hex string. */
function rustBytesToHex(literal: string): string {
  const bytes = literal.match(/0x[0-9a-fA-F]{2}/g);
  if (!bytes) return '';
  return '0x' + bytes.map((b) => b.slice(2)).join('');
}

/**
 * Parse all Vector instances from a Rust source file containing a
 * `pub const VECTORS: &[Vector] = &[...]` block.
 */
function parseRustVectors(source: string): ParsedVector[] {
  const vectors: ParsedVector[] = [];

  // Split on "Vector {" to get each struct body
  const parts = source.split(/\bVector\s*\{/);
  // Skip the first part (before the first Vector block)
  for (let i = 1; i < parts.length; i++) {
    const body = parts[i];

    // name: "..."
    const nameMatch = body.match(/name:\s*"([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];

    // leaf: [0xAA, ...]
    const leafMatch = body.match(/leaf:\s*(\[[^\]]+\])/);
    if (!leafMatch) continue;
    const leaf = rustBytesToHex(leafMatch[1]);

    // proof: &[...] — may span multiple lines; grab the content between &[ and the matching ]
    const proofStartIdx = body.indexOf('proof:');
    if (proofStartIdx === -1) continue;
    const proofSlice = body.slice(proofStartIdx);
    const proofAmpBracket = proofSlice.indexOf('&[');
    const proofContent = proofSlice.slice(proofAmpBracket + 2);

    // Walk forward to find the matching closing bracket for the proof array
    let depth = 1;
    let proofEnd = 0;
    for (let j = 0; j < proofContent.length; j++) {
      if (proofContent[j] === '[') depth++;
      else if (proofContent[j] === ']') {
        depth--;
        if (depth === 0) {
          proofEnd = j;
          break;
        }
      }
    }
    const proofBody = proofContent.slice(0, proofEnd);

    // Each sibling is a [0xAA, ...] array
    const proof: string[] = [];
    const siblingRegex = /\[([^\]]+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = siblingRegex.exec(proofBody)) !== null) {
      proof.push(rustBytesToHex('[' + m[1] + ']'));
    }

    // root: [0xAA, ...]
    const rootMatch = body.match(/root:\s*(\[[^\]]+\])/);
    if (!rootMatch) continue;
    const root = rustBytesToHex(rootMatch[1]);

    // expected: true | false
    const expectedMatch = body.match(/expected:\s*(true|false)/);
    if (!expectedMatch) continue;
    const expected = expectedMatch[1] === 'true';

    vectors.push({ name, leaf, proof, root, expected });
  }

  return vectors;
}

function loadJson(): JsonVector[] {
  const raw = readFileSync(resolve(PKG_DIR, 'merkle-vectors.json'), 'utf-8');
  const doc = JSON.parse(raw) as { vectors: JsonVector[] };
  return doc.vectors;
}

function loadRust(relPath: string): ParsedVector[] {
  const source = readFileSync(resolve(PKG_DIR, relPath), 'utf-8');
  return parseRustVectors(source);
}

function assertVectorsMatchJson(
  label: string,
  rustVectors: ParsedVector[],
  jsonVectors: JsonVector[],
) {
  expect(rustVectors.length, `${label}: expected 14 vectors, found ${rustVectors.length}`).toBe(14);

  for (let i = 0; i < rustVectors.length; i++) {
    const rv = rustVectors[i];
    const jv = jsonVectors.find((v) => v.name === rv.name);

    expect(jv, `${label}[${i}]: no JSON vector named "${rv.name}"`).toBeDefined();
    if (!jv) continue;

    expect(rv.leaf, `${label}[${i}] "${rv.name}": leaf mismatch`).toBe(jv.leaf);
    expect(rv.proof.length, `${label}[${i}] "${rv.name}": proof length mismatch`).toBe(
      jv.proof.length,
    );
    for (let p = 0; p < jv.proof.length; p++) {
      expect(rv.proof[p], `${label}[${i}] "${rv.name}": proof[${p}] mismatch`).toBe(jv.proof[p]);
    }
    expect(rv.root, `${label}[${i}] "${rv.name}": root mismatch`).toBe(jv.root);
    expect(rv.expected, `${label}[${i}] "${rv.name}": expected mismatch`).toBe(jv.expected);
  }
}

describe('Merkle vector parity (issue #767)', () => {
  const jsonVectors = loadJson();

  it('JSON fixture has at least 14 vectors', () => {
    expect(jsonVectors.length).toBeGreaterThanOrEqual(14);
  });

  describe('vectors.rs (generated)', () => {
    const rustVectors = loadRust('vectors.rs');

    it('has exactly 14 vectors', () => {
      expect(rustVectors.length).toBe(14);
    });

    it('each vector matches the JSON case for case', () => {
      assertVectorsMatchJson('vectors.rs', rustVectors, jsonVectors);
    });
  });

  describe('src/lib.rs (hand-maintained)', () => {
    const rustVectors = loadRust('src/lib.rs');

    it('has exactly 14 vectors', () => {
      expect(rustVectors.length).toBe(14);
    });

    it('each vector matches the JSON case for case', () => {
      assertVectorsMatchJson('src/lib.rs', rustVectors, jsonVectors);
    });
  });
});
