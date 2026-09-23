// Regenerates merkle-vectors.json, the shared conformance fixture asserting that
// the TypeScript SDK and the Soroban ReceiptAnchor contract agree on the same
// sorted-pair SHA-256 Merkle convention.
//
// The same file is consumed by:
//   - packages/sdk/merkle.test.ts            (accensa-app)
//   - contracts/receipt-anchor/src/test.rs   (accensa-contracts)
//
// Run:  node packages/sdk/scripts/generate-vectors.mjs
//
// Leaves are derived deterministically from fixed strings, so regenerating this
// file on any machine must produce byte-identical output; CI enforces that with
// `git diff --exit-code` after re-running this script. The emitted bytes are
// therefore part of the contract, so the helpers below are kept small and are
// exported for `generate-vectors.test.ts` to pin directly, rather than the unit
// tests having to regenerate the whole fixture to observe a regression.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

/** Raised for anything this script cannot turn into a valid vector. */
export class VectorGenerationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VectorGenerationError';
  }
}

/** Lowercase hex-encoded 32-byte hash — the only form the fixture ever contains. */
const HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Confirms a value is a hex-encoded 32-byte hash, and returns it.
 *
 * A short or upper-case hash would not fail loudly on its own: it would render
 * into a fixture the contract tests reject, or one whose bytes depend on how a
 * value was produced. Failing where the value is constructed keeps it local.
 */
export function assertHash(value, label) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    const seen = typeof value === 'string' ? `"${value}"` : String(value);
    throw new VectorGenerationError(
      `${label} must be a lowercase hex-encoded 32-byte hash (64 hex chars), received ${seen}`,
    );
  }
  return value;
}

/** SHA-256 of a buffer. */
export const sha256 = (buf) => createHash('sha256').update(buf).digest();

/** Deterministic leaf for a vector label: SHA-256 over the label's UTF-8 bytes. */
export const leafOf = (label) => sha256(Buffer.from(label, 'utf8'));

/** Lowercase hex encoding of one hash. */
export const hex = (buf) => assertHash(buf.toString('hex'), 'hash');

/**
 * Combines two nodes smaller-hash-first, so proofs need no position flags.
 *
 * `Buffer.compare` orders by byte value, matching the Rust
 * `ReceiptAnchor::verify_receipt` comparison. Comparing as numbers instead
 * would produce roots the contract rejects.
 */
export function combine(a, b) {
  const [lo, hi] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return sha256(Buffer.concat([lo, hi]));
}

/**
 * Builds every level of the tree, leaves first.
 *
 * An odd node at the end of a level is promoted unchanged to the next level
 * rather than duplicated — duplicating it, as the Bitcoin convention does,
 * would give a different root for every odd-length batch.
 */
export function buildLevels(leaves) {
  if (!Array.isArray(leaves) || leaves.length === 0) {
    throw new VectorGenerationError('buildLevels requires at least one leaf');
  }
  const levels = [leaves];
  let level = leaves;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? combine(level[i], level[i + 1]) : level[i]);
    }
    levels.push(next);
    level = next;
  }
  return levels;
}

/**
 * Leaf-to-root sibling hashes for the leaf at `index`.
 *
 * A promoted odd node has no sibling at that level, so its proof is one entry
 * shorter instead of carrying a filler — the difference between an empty proof
 * and a real one has to stay observable.
 */
export function proofFor(levels, index) {
  const leafCount = levels[0].length;
  if (!Number.isInteger(index) || index < 0 || index >= leafCount) {
    throw new VectorGenerationError(
      `proofFor index ${index} is out of range for ${leafCount} leaf/leaves`,
    );
  }
  const proof = [];
  let i = index;
  for (let l = 0; l < levels.length - 1; l++) {
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < levels[l].length) proof.push(levels[l][sibling]);
    i = Math.floor(i / 2);
  }
  return proof;
}

/**
 * Builds the tree for `labels`, plus the leaf and proof for `index`.
 *
 * @throws {VectorGenerationError} if `labels` is empty or `index` is not one of its positions
 */
export function buildBatch(labels, index) {
  if (!Array.isArray(labels) || labels.length === 0) {
    throw new VectorGenerationError('buildBatch requires at least one label');
  }
  if (!Number.isInteger(index) || index < 0 || index >= labels.length) {
    throw new VectorGenerationError(
      `buildBatch index ${index} is out of range for ${labels.length} label(s)`,
    );
  }
  const leaves = labels.map(leafOf);
  const levels = buildLevels(leaves);
  return {
    leaves,
    root: levels[levels.length - 1][0],
    leaf: leaves[index],
    proof: proofFor(levels, index),
  };
}

/** Converts one in-memory batch result into a serialisable case. */
function vectorCase({ name, leaf, proof, root, expected, note }) {
  return note === undefined
    ? { name, leaf: hex(leaf), proof: proof.map(hex), root: hex(root), expected }
    : { name, leaf: hex(leaf), proof: proof.map(hex), root: hex(root), expected, note };
}

/** Labels of the batch anchored live on Stellar testnet as batch #1. */
export const LIVE_BATCH_LABELS = [
  'receipt-001:150.00',
  'receipt-002:24.50',
  'receipt-003:500.00',
  'receipt-004:12.25',
];

/**
 * Every conformance case, in fixture order, plus the on-chain batch root.
 *
 * Order is part of the fixture's meaning: the first two cases are the batch
 * anchored on-chain, which `merkle.test.ts` asserts by index.
 */
export function buildCases() {
  const cases = [];

  // The batch anchored live on Stellar testnet as batch #1.
  const live = buildBatch(LIVE_BATCH_LABELS, 0);
  cases.push(
    vectorCase({
      name: 'live testnet batch #1 — valid membership proof',
      leaf: live.leaf,
      proof: live.proof,
      root: live.root,
      expected: true,
      note: 'Anchored on-chain; verify_receipt returns true for these exact inputs.',
    }),
  );
  cases.push(
    vectorCase({
      name: 'live testnet batch #1 — forged leaf is rejected',
      leaf: leafOf('receipt-999:forged'),
      proof: live.proof,
      root: live.root,
      expected: false,
      note: 'A receipt that was never in the batch cannot be proven into it.',
    }),
  );

  // Single-leaf batch: the root is the leaf and the proof is empty.
  const single = buildBatch(['solo-receipt'], 0);
  cases.push(
    vectorCase({
      name: 'single-leaf batch — empty proof',
      leaf: single.leaf,
      proof: [],
      root: single.root,
      expected: true,
      note: 'Root equals the leaf; an empty proof must verify.',
    }),
  );
  cases.push(
    vectorCase({
      name: 'single-leaf batch — empty proof against wrong root',
      leaf: single.leaf,
      proof: [],
      root: leafOf('some-other-batch'),
      expected: false,
    }),
  );

  // Two-leaf batch, proving each side. Together these exercise both branches of
  // the sorted-pair comparison (computed < sibling and computed > sibling).
  const pairLabels = ['pair-a', 'pair-b'];
  for (const [i, side] of [
    [0, 'left'],
    [1, 'right'],
  ]) {
    const b = buildBatch(pairLabels, i);
    cases.push(
      vectorCase({
        name: `two-leaf batch — ${side} leaf`,
        leaf: b.leaf,
        proof: b.proof,
        root: b.root,
        expected: true,
      }),
    );
  }

  // Odd leaf count: the last node is promoted, so the deepest leaf has a shorter proof.
  const oddLabels = ['odd-1', 'odd-2', 'odd-3'];
  for (const i of [0, 2]) {
    const b = buildBatch(oddLabels, i);
    cases.push(
      vectorCase({
        name: `three-leaf batch — leaf ${i}`,
        leaf: b.leaf,
        proof: b.proof,
        root: b.root,
        expected: true,
        note: i === 2 ? 'Promoted odd node: proof is one level shorter.' : undefined,
      }),
    );
  }

  // A larger batch, proving first, middle, and last membership.
  const eightLabels = Array.from({ length: 8 }, (_, i) => `bulk-receipt-${i}`);
  for (const i of [0, 3, 7]) {
    const b = buildBatch(eightLabels, i);
    cases.push(
      vectorCase({
        name: `eight-leaf batch — leaf ${i}`,
        leaf: b.leaf,
        proof: b.proof,
        root: b.root,
        expected: true,
      }),
    );
  }

  // A valid proof does not verify against a different batch's root.
  const eight = buildBatch(eightLabels, 3);
  cases.push(
    vectorCase({
      name: 'valid proof against a different root is rejected',
      leaf: eight.leaf,
      proof: eight.proof,
      root: live.root,
      expected: false,
    }),
  );

  // Reordering a proof breaks it, because each step feeds the next.
  cases.push(
    vectorCase({
      name: 'reordered proof is rejected',
      leaf: eight.leaf,
      proof: [...eight.proof].reverse(),
      root: eight.root,
      expected: false,
      note: 'Proof order is leaf-to-root and is not commutative across levels.',
    }),
  );

  // Truncating a proof breaks it.
  cases.push(
    vectorCase({
      name: 'truncated proof is rejected',
      leaf: eight.leaf,
      proof: eight.proof.slice(0, -1),
      root: eight.root,
      expected: false,
    }),
  );

  return { cases, liveRoot: hex(live.root) };
}

/** The JSON fixture. */
export function buildFixture(cases, liveRoot) {
  return {
    $comment:
      'GENERATED FILE — do not edit by hand. Run packages/sdk/scripts/generate-vectors.mjs.',
    description:
      'Shared conformance vectors for Accensa receipt verification. Consumed by the ' +
      'TypeScript SDK and by the Soroban ReceiptAnchor contract tests, so both ' +
      'implementations are pinned to identical behaviour.',
    algorithm: {
      hash: 'SHA-256',
      pairing:
        'sorted-pair: siblings are concatenated smaller-hash-first, so proofs carry ' +
        'no left/right position flags',
      oddNode: 'an unpaired node at the end of a level is promoted unchanged',
      proofOrder: 'leaf-to-root',
    },
    onchain: {
      network: 'testnet',
      contract: 'CBHRJU7CF4XIFRNDITFHNQHABKBMFM2FYFHLGWN3JGSFYYCDSMDAWPRV',
      batchId: 1,
      root: assertHash(liveRoot, 'onchain root'),
      note: 'The first two cases below are the batch anchored on-chain.',
    },
    cases,
  };
}

/** Renders one hash as a Rust `[u8; 32]` literal. */
export function bytes(hash) {
  return `[${assertHash(hash, 'vector hash')
    .match(/../g)
    .map((byte) => `0x${byte}`)
    .join(', ')}]`;
}

/** Renders one Rust `Vector { .. }` entry. */
export function renderVector(c) {
  const proof = c.proof.length
    ? '\n' + c.proof.map((p) => `            ${bytes(p)},`).join('\n') + '\n        '
    : '';
  return `    Vector {
        name: ${JSON.stringify(c.name)},
        leaf: ${bytes(c.leaf)},
        proof: &[${proof}],
        root: ${bytes(c.root)},
        expected: ${c.expected},
    },`;
}

/**
 * The Rust mirror of the fixture.
 *
 * The contract tests run in a `no_std` crate and cannot parse JSON, so the same
 * vectors are emitted as a constant. Both artifacts are rendered from one set
 * of in-memory cases, so they cannot drift from each other.
 */
export function renderRust(cases) {
  return `// GENERATED FILE — do not edit by hand.
//
// Emitted by packages/sdk/scripts/generate-vectors.mjs in the accensa-app repo,
// from the same source of truth as packages/sdk/merkle-vectors.json. The
// TypeScript SDK and this contract are tested against byte-identical vectors,
// so any divergence between the two implementations fails one of the suites.
//
// To regenerate:
//   node packages/sdk/scripts/generate-vectors.mjs   # in accensa-app
//   cp packages/sdk/vectors.rs \\
//      ../accensa-contracts/contracts/receipt-anchor/src/vectors.rs

pub struct Vector {
    pub name: &'static str,
    pub leaf: [u8; 32],
    pub proof: &'static [[u8; 32]],
    pub root: [u8; 32],
    pub expected: bool,
}

// Generated layout is intentionally dense; rustfmt would reflow every hash
// literal and make regeneration produce spurious diffs.
#[rustfmt::skip]
pub const VECTORS: &[Vector] = &[
${cases.map(renderVector).join('\n')}
];
`;
}

/** Writes one artifact, adding the path to any failure so a broken run is actionable. */
function writeArtifact(path, contents) {
  try {
    writeFileSync(path, contents);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new VectorGenerationError(`could not write ${path}: ${reason}`);
  }
  return Buffer.byteLength(contents);
}

/** Absolute path of the artifacts, resolved from the script's own location. */
export function artifactPaths(scriptDir) {
  return {
    json: join(scriptDir, '..', 'merkle-vectors.json'),
    rust: join(scriptDir, '..', 'vectors.rs'),
  };
}

/**
 * Renders both artifacts and writes them next to the package.
 *
 * Returns the exact bytes written alongside their paths, so a caller — the unit
 * tests, or CI — can compare them against what is committed on disk.
 *
 * @param scriptDir directory holding this script; artifacts land in its parent
 * @param out sink for the progress lines, injectable so tests can capture them
 */
export function generate({ scriptDir, out = console.log }) {
  if (!scriptDir) {
    throw new VectorGenerationError(
      'generate requires the script directory to resolve output paths',
    );
  }
  const { cases, liveRoot } = buildCases();
  const fixture = buildFixture(cases, liveRoot);
  const rust = renderRust(cases);
  const paths = artifactPaths(scriptDir);

  const jsonBytes = writeArtifact(paths.json, JSON.stringify(fixture) + '\n');
  out(`wrote ${paths.json} (${fixture.cases.length} cases, ${jsonBytes} bytes)`);

  const rustBytes = writeArtifact(paths.rust, rust);
  out(`wrote ${paths.rust} (${rustBytes} bytes)`);

  return { paths, json: JSON.stringify(fixture) + '\n', rust };
}

/**
 * True only when this file was run as a script.
 *
 * Without the guard, importing the module — as the unit tests do — would
 * rewrite the committed fixture as a side effect of the import.
 */
export function isRunDirectly(argv = process.argv) {
  return Boolean(argv[1]) && import.meta.url === pathToFileURL(argv[1]).href;
}

/**
 * Entry point: generate, and turn a failure into a clear message plus a non-zero
 * exit code, rather than a stack trace from inside a helper.
 */
export function main({ out = console.log, error = console.error } = {}) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  try {
    const { paths } = generate({ scriptDir, out });
    out(
      `copy ${paths.rust} to accensa-contracts/contracts/receipt-anchor/src/vectors.rs, ` +
        `then verify with: git diff --exit-code -- packages/sdk/merkle-vectors.json packages/sdk/vectors.rs`,
    );
    return 0;
  } catch (err) {
    error(`generate-vectors failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return 1;
  }
}

if (isRunDirectly()) main();
