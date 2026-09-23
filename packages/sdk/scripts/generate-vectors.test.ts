// Unit tests for the conformance-vector generator.
//
// Testing strategy:
//
//   1. Helpers are pinned individually. The generator's output is a committed
//      artifact that a second repository consumes, so a regression shows up as a
//      diff in `merkle-vectors.json` — far from the code that caused it. Testing
//      `combine`, `buildLevels` and `proofFor` directly names the broken rule.
//   2. Failure modes are asserted on their messages. Every guard exists so a
//      malformed vector fails here instead of in the contract's test suite, and
//      the message is the only thing that makes that failure actionable.
//   3. Output is compared byte-for-byte against what is committed, in a temp
//      directory so the check never rewrites the working tree. This is the same
//      assertion CI makes with `git diff --exit-code`, available locally.
//   4. The generated tree is cross-checked against `buildBatch` from `merkle.ts`,
//      the SDK's production implementation, so the fixture cannot drift from the
//      code that consumes it.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIVE_BATCH_LABELS,
  VectorGenerationError,
  artifactPaths,
  assertHash,
  buildBatch,
  buildCases,
  buildFixture,
  buildLevels,
  bytes,
  combine,
  generate,
  hex,
  isRunDirectly,
  leafOf,
  proofFor,
  renderRust,
  sha256,
} from './generate-vectors.mjs';
import { buildBatch as productionBuildBatch } from '../merkle';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(scriptDir, '..');

/** Leaves for a batch of labels, as the generator's tree helpers take them. */
const leavesOf = (labels: string[]) => labels.map((label) => leafOf(label));

/** The same leaves as hex, the form `merkle.ts` takes. */
const leafHexesOf = (labels: string[]) => leavesOf(labels).map(hex);

describe('hash helpers', () => {
  it('derives leaves deterministically from their label', () => {
    expect(hex(leafOf('receipt-001:150.00'))).toBe(
      createHash('sha256').update('receipt-001:150.00', 'utf8').digest('hex'),
    );
    expect(leafOf('receipt-001:150.00').equals(leafOf('receipt-001:150.00'))).toBe(true);
    expect(leafOf('a').equals(leafOf('b'))).toBe(false);
  });

  it('hashes an empty label without throwing', () => {
    expect(hex(leafOf(''))).toBe(sha256(Buffer.alloc(0)).toString('hex'));
  });

  it.each([
    ['short input', 'abc'],
    ['31 bytes', 'a'.repeat(62)],
    ['33 bytes', 'a'.repeat(66)],
    ['upper case', 'A'.repeat(64)],
    ['non-hex characters', 'z'.repeat(64)],
    ['0x prefix', '0x' + 'a'.repeat(62)],
    ['empty string', ''],
  ])('rejects a %s', (_name, value) => {
    expect(() => assertHash(value, 'leaf')).toThrow(VectorGenerationError);
    expect(() => assertHash(value, 'leaf')).toThrow(/leaf must be a lowercase hex-encoded/);
  });

  it('names the offending value and label in the error', () => {
    expect(() => assertHash('nope', 'onchain root')).toThrow(/onchain root .*received "nope"/);
    expect(() => assertHash(undefined, 'proof[2]')).toThrow(/proof\[2\].*received undefined/);
  });

  it('returns the value it validated', () => {
    const hash = 'a'.repeat(64);
    expect(assertHash(hash, 'leaf')).toBe(hash);
  });
});

describe('combine — sorted-pair convention', () => {
  it('is order independent, so proofs need no position flags', () => {
    const [a, b] = leavesOf(['pair-a', 'pair-b']);
    expect(hex(combine(a, b))).toBe(hex(combine(b, a)));
  });

  it('hashes the smaller hash first', () => {
    const a = leafOf('pair-a');
    const b = leafOf('pair-b');
    const [lo, hi] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
    expect(hex(combine(a, b))).toBe(sha256(Buffer.concat([lo, hi])).toString('hex'));
  });

  it('differs from pairing the larger hash first', () => {
    // Guards the rule itself rather than just order independence: if `combine`
    // hashed its arguments as given, this pairing would agree with it, and the
    // sorted-pair convention would be untested by every other case here.
    const a = leafOf('pair-a');
    const b = leafOf('pair-b');
    const [lo, hi] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];

    expect(hex(combine(a, b))).toBe(sha256(Buffer.concat([lo, hi])).toString('hex'));
    expect(hex(combine(a, b))).not.toBe(sha256(Buffer.concat([hi, lo])).toString('hex'));
  });
});

describe('buildLevels', () => {
  it('collapses a single leaf to a one-level tree', () => {
    const leaves = leavesOf(['solo']);
    expect(buildLevels(leaves)).toEqual([leaves]);
  });

  it('promotes an unpaired node instead of duplicating it', () => {
    const labels = ['odd-1', 'odd-2', 'odd-3'];
    const leaves = leavesOf(labels);
    const levels = buildLevels(leaves);

    expect(levels).toHaveLength(3);
    expect(levels[1]).toHaveLength(2);
    expect(levels[2]).toHaveLength(1);
    // Third leaf carried up unchanged, not paired with a copy of itself.
    expect(levels[1][1].equals(leaves[2])).toBe(true);
    const duplicated = combine(leaves[2], leaves[2]);
    expect(levels[1][1].equals(duplicated)).toBe(false);
  });

  it('builds a fully paired tree for a power-of-two leaf count', () => {
    const leaves = leavesOf(Array.from({ length: 8 }, (_, i) => `bulk-receipt-${i}`));
    const levels = buildLevels(leaves);
    expect(levels.map((level) => level.length)).toEqual([8, 4, 2, 1]);
  });

  it('rejects an empty leaf list', () => {
    expect(() => buildLevels([])).toThrow(VectorGenerationError);
    expect(() => buildLevels([])).toThrow('buildLevels requires at least one leaf');
    expect(() => buildLevels(undefined as unknown as Buffer[])).toThrow(
      'buildLevels requires at least one leaf',
    );
  });
});

describe('proofFor', () => {
  it('returns an empty proof for a single-leaf batch', () => {
    expect(proofFor(buildLevels(leavesOf(['solo'])), 0)).toEqual([]);
  });

  it('returns one sibling per level for a paired leaf', () => {
    const labels = ['odd-1', 'odd-2', 'odd-3'];
    const levels = buildLevels(leavesOf(labels));
    expect(proofFor(levels, 0)).toHaveLength(2);
    expect(proofFor(levels, 1)).toHaveLength(2);
  });

  it('returns a shorter proof for a promoted node', () => {
    const levels = buildLevels(leavesOf(['odd-1', 'odd-2', 'odd-3']));
    expect(proofFor(levels, 2)).toHaveLength(1);
  });

  it('emits leaf-to-root order', () => {
    const leaves = leavesOf(['a', 'b', 'c', 'd']);
    const levels = buildLevels(leaves);
    const proof = proofFor(levels, 0);
    expect(hex(proof[0])).toBe(hex(leaves[1]));
    expect(hex(proof[1])).toBe(hex(combine(leaves[2], leaves[3])));
  });

  it.each([
    ['a negative index', -1],
    ['an index past the end', 4],
    ['a non-integer index', 1.5],
  ])('rejects %s with the range in the message', (_name, index) => {
    const levels = buildLevels(leavesOf(['a', 'b', 'c', 'd']));
    expect(() => proofFor(levels, index)).toThrow(VectorGenerationError);
    expect(() => proofFor(levels, index)).toThrow(
      `proofFor index ${index} is out of range for 4 leaf/leaves`,
    );
  });
});

describe('buildBatch', () => {
  it('derives the root, leaf and proof for the requested index', () => {
    const labels = ['pair-a', 'pair-b'];
    const batch = buildBatch(labels, 1);
    expect(batch.leaves).toHaveLength(2);
    expect(hex(batch.leaf)).toBe(hex(leafOf('pair-b')));
    expect(batch.proof).toHaveLength(1);
    expect(hex(batch.proof[0])).toBe(hex(leafOf('pair-a')));
    expect(hex(batch.root)).toBe(hex(combine(leafOf('pair-a'), leafOf('pair-b'))));
  });

  it('rejects an empty label list', () => {
    expect(() => buildBatch([], 0)).toThrow('buildBatch requires at least one label');
  });

  it.each([
    ['a negative index', -1],
    ['an index past the end', 2],
    ['a non-integer index', 0.5],
  ])('rejects %s with the batch size in the message', (_name, index) => {
    expect(() => buildBatch(['pair-a', 'pair-b'], index)).toThrow(VectorGenerationError);
    expect(() => buildBatch(['pair-a', 'pair-b'], index)).toThrow(
      `buildBatch index ${index} is out of range for 2 label(s)`,
    );
  });

  it('agrees with the production implementation in merkle.ts', () => {
    // The generator defines the tree the SDK and the contract are tested
    // against, so a change here that `buildBatch` does not follow is exactly the
    // drift the fixture exists to catch. This is the on-chain batch, so the
    // fixture's first case is a real proof for a real root.
    const { cases, liveRoot } = buildCases();
    const leafHexes = leafHexesOf(LIVE_BATCH_LABELS);
    const production = productionBuildBatch(leafHexes);

    expect(production.root).toBe(liveRoot);
    expect(cases[0].leaf).toBe(leafHexes[0]);
    expect(cases[0].proof).toEqual(production.proofs[leafHexes[0]]);
  });

  it('agrees with the production implementation for an odd-length batch', () => {
    const leafHexes = leafHexesOf(['odd-1', 'odd-2', 'odd-3']);
    const production = productionBuildBatch(leafHexes);
    const generated = buildBatch(['odd-1', 'odd-2', 'odd-3'], 2);

    expect(hex(generated.root)).toBe(production.root);
    expect(generated.proof.map(hex)).toEqual(production.proofs[leafHexes[2]]);
  });
});

describe('buildCases', () => {
  const { cases, liveRoot } = buildCases();

  it('covers both accepted and rejected expectations', () => {
    expect(new Set(cases.map((c) => c.expected))).toEqual(new Set([true, false]));
  });

  it('describes the on-chain batch in the first two cases', () => {
    expect(cases[0].expected).toBe(true);
    expect(cases[1].expected).toBe(false);
    expect(cases[0].root).toBe(liveRoot);
    expect(cases[1].root).toBe(liveRoot);
    expect(cases[1].leaf).not.toBe(cases[0].leaf);
  });

  it('encodes every hash as lowercase 32-byte hex', () => {
    for (const c of cases) {
      for (const hash of [c.leaf, c.root, ...c.proof]) {
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it('omits the note key entirely when a case has no note', () => {
    // Serialised straight to JSON, so `undefined` would vanish anyway — but the
    // key order and presence are part of the committed bytes.
    const withoutNote = cases.filter((c) => !c.note);
    expect(withoutNote.length).toBeGreaterThan(0);
    for (const c of withoutNote) expect(Object.keys(c)).not.toContain('note');
  });

  it('has unique case names, so a fixture diff points at one case', () => {
    const names = cases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('buildFixture', () => {
  const { cases, liveRoot } = buildCases();
  const fixture = buildFixture(cases, liveRoot);

  it('documents the algorithm the cases encode', () => {
    expect(fixture.algorithm).toEqual({
      hash: 'SHA-256',
      pairing:
        'sorted-pair: siblings are concatenated smaller-hash-first, so proofs carry ' +
        'no left/right position flags',
      oddNode: 'an unpaired node at the end of a level is promoted unchanged',
      proofOrder: 'leaf-to-root',
    });
  });

  it('records the on-chain batch that the first cases come from', () => {
    expect(fixture.onchain.batchId).toBe(1);
    expect(fixture.onchain.network).toBe('testnet');
    expect(fixture.onchain.root).toBe(liveRoot);
  });

  it('rejects a malformed on-chain root', () => {
    expect(() => buildFixture(cases, 'not-a-hash')).toThrow(/onchain root/);
  });

  it('round-trips through JSON unchanged', () => {
    expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture);
  });
});

describe('Rust rendering', () => {
  const { cases } = buildCases();

  it('emits one Vector per case', () => {
    const rust = renderRust(cases);
    expect(rust.match(/^    Vector \{$/gm)).toHaveLength(cases.length);
    expect(rust).toContain('pub const VECTORS: &[Vector] = &[');
    expect(rust.trimEnd().endsWith('];')).toBe(true);
  });

  it('renders each proof with the same number of siblings as the case', () => {
    const rust = renderRust(cases);
    for (const c of cases) {
      const literal = c.proof.map(bytes);
      for (const sibling of literal) expect(rust).toContain(sibling);
    }
    // The single-leaf case is the only one with an empty proof array.
    const emptyProofs = rust.match(/proof: &\[\],/g) ?? [];
    expect(emptyProofs).toHaveLength(cases.filter((c) => c.proof.length === 0).length);
  });

  it('renders expected as a Rust bool literal', () => {
    const rust = renderRust(cases);
    expect(rust).toContain(`expected: ${cases[0].expected}`);
    expect(rust).toContain('expected: false');
  });

  it('escapes names rather than interpolating them raw', () => {
    const [rendered] = [
      renderRust([
        {
          name: 'quote " inside',
          leaf: cases[0].leaf,
          proof: [],
          root: cases[0].root,
          expected: true,
        },
      ]),
    ];
    expect(rendered).toContain('name: "quote \\" inside"');
  });

  it('rejects a malformed hash before rendering it', () => {
    expect(() => bytes('xyz')).toThrow(VectorGenerationError);
    expect(() => bytes('a'.repeat(64).toUpperCase())).toThrow(/vector hash/);
  });
});

describe('generate', () => {
  it('writes artifacts byte-identical to the committed ones', () => {
    const root = mkdtempSync(join(tmpdir(), 'accensa-vectors-'));
    const dir = join(root, 'sdk', 'scripts');
    mkdirSync(dir, { recursive: true });

    const lines: string[] = [];
    const { paths, json, rust } = generate({
      scriptDir: dir,
      out: (line: string) => lines.push(line),
    });

    expect(paths).toEqual(artifactPaths(dir));
    expect(readFileSync(paths.json, 'utf8')).toBe(json);
    expect(readFileSync(paths.rust, 'utf8')).toBe(rust);

    // Same bytes as committed: any diff here would fail CI's reproducibility check.
    expect(json).toBe(readFileSync(join(packageDir, 'merkle-vectors.json'), 'utf8'));
    expect(rust).toBe(readFileSync(join(packageDir, 'vectors.rs'), 'utf8'));
  });

  it('reports what it wrote, once per artifact', () => {
    const root = mkdtempSync(join(tmpdir(), 'accensa-vectors-'));
    const dir = join(root, 'sdk', 'scripts');
    mkdirSync(dir, { recursive: true });

    const lines: string[] = [];
    generate({ scriptDir: dir, out: (line: string) => lines.push(line) });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/merkle-vectors\.json \(14 cases, \d+ bytes\)/);
    expect(lines[1]).toMatch(/vectors\.rs \(\d+ bytes\)/);
  });

  it('reports the case count actually written', () => {
    const root = mkdtempSync(join(tmpdir(), 'accensa-vectors-'));
    const dir = join(root, 'sdk', 'scripts');
    mkdirSync(dir, { recursive: true });

    const lines: string[] = [];
    const { json } = generate({ scriptDir: dir, out: (line: string) => lines.push(line) });
    const parsed = JSON.parse(json) as { cases: unknown[] };
    expect(lines[0]).toContain(`${parsed.cases.length} cases`);
  });

  it('fails with the output path when it cannot write an artifact', () => {
    expect(() => generate({ scriptDir: join(tmpdir(), 'accensa-missing-dir', 'scripts') })).toThrow(
      VectorGenerationError,
    );
    expect(() => generate({ scriptDir: join(tmpdir(), 'accensa-missing-dir', 'scripts') })).toThrow(
      /could not write .*merkle-vectors\.json/,
    );
  });

  it('requires a script directory, since the paths derive from it', () => {
    expect(() => generate({} as { scriptDir?: string })).toThrow(
      'generate requires the script directory to resolve output paths',
    );
  });
});

describe('isRunDirectly', () => {
  it('is false when the module is imported, which is how the tests use it', () => {
    // If this regressed, importing this module would rewrite the committed fixture.
    expect(isRunDirectly()).toBe(false);
  });

  it('is false when no script path was passed', () => {
    expect(isRunDirectly([])).toBe(false);
    expect(isRunDirectly(['node'])).toBe(false);
  });
});
