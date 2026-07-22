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
// file on any machine must produce byte-identical output.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const sha256 = (buf) => createHash('sha256').update(buf).digest();
const leafOf = (label) => sha256(Buffer.from(label, 'utf8'));

/** Combine two nodes smaller-hash-first, so proofs need no position flags. */
const combine = (a, b) =>
  Buffer.compare(a, b) <= 0
    ? sha256(Buffer.concat([a, b]))
    : sha256(Buffer.concat([b, a]));

/**
 * Builds every level of the tree. An odd node at the end of a level is promoted
 * unchanged to the next level rather than duplicated.
 */
function buildLevels(leaves) {
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

function proofFor(levels, index) {
  const proof = [];
  let i = index;
  for (let l = 0; l < levels.length - 1; l++) {
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < levels[l].length) proof.push(levels[l][sibling]);
    i = Math.floor(i / 2);
  }
  return proof;
}

const hex = (b) => b.toString('hex');

/** A batch, plus the membership proof for one of its leaves. */
function batch(labels, index) {
  const leaves = labels.map(leafOf);
  const levels = buildLevels(leaves);
  return {
    leaves,
    root: levels[levels.length - 1][0],
    leaf: leaves[index],
    proof: proofFor(levels, index),
  };
}

const cases = [];

// The batch anchored live on Stellar testnet as batch #1.
const live = batch(
  ['receipt-001:150.00', 'receipt-002:24.50', 'receipt-003:500.00', 'receipt-004:12.25'],
  0,
);
cases.push({
  name: 'live testnet batch #1 — valid membership proof',
  leaf: hex(live.leaf),
  proof: live.proof.map(hex),
  root: hex(live.root),
  expected: true,
  note: 'Anchored on-chain; verify_receipt returns true for these exact inputs.',
});
cases.push({
  name: 'live testnet batch #1 — forged leaf is rejected',
  leaf: hex(leafOf('receipt-999:forged')),
  proof: live.proof.map(hex),
  root: hex(live.root),
  expected: false,
  note: 'A receipt that was never in the batch cannot be proven into it.',
});

// Single-leaf batch: the root is the leaf and the proof is empty.
const single = batch(['solo-receipt'], 0);
cases.push({
  name: 'single-leaf batch — empty proof',
  leaf: hex(single.leaf),
  proof: [],
  root: hex(single.root),
  expected: true,
  note: 'Root equals the leaf; an empty proof must verify.',
});
cases.push({
  name: 'single-leaf batch — empty proof against wrong root',
  leaf: hex(single.leaf),
  proof: [],
  root: hex(leafOf('some-other-batch')),
  expected: false,
});

// Two-leaf batch, proving each side. Together these exercise both branches of
// the sorted-pair comparison (computed < sibling and computed > sibling).
const pairLabels = ['pair-a', 'pair-b'];
for (const [i, side] of [[0, 'left'], [1, 'right']]) {
  const b = batch(pairLabels, i);
  cases.push({
    name: `two-leaf batch — ${side} leaf`,
    leaf: hex(b.leaf),
    proof: b.proof.map(hex),
    root: hex(b.root),
    expected: true,
  });
}

// Odd leaf count: the last node is promoted, so the deepest leaf has a shorter proof.
const oddLabels = ['odd-1', 'odd-2', 'odd-3'];
for (const i of [0, 2]) {
  const b = batch(oddLabels, i);
  cases.push({
    name: `three-leaf batch — leaf ${i}`,
    leaf: hex(b.leaf),
    proof: b.proof.map(hex),
    root: hex(b.root),
    expected: true,
    note: i === 2 ? 'Promoted odd node: proof is one level shorter.' : undefined,
  });
}

// A larger batch, proving first, middle, and last membership.
const eightLabels = Array.from({ length: 8 }, (_, i) => `bulk-receipt-${i}`);
for (const i of [0, 3, 7]) {
  const b = batch(eightLabels, i);
  cases.push({
    name: `eight-leaf batch — leaf ${i}`,
    leaf: hex(b.leaf),
    proof: b.proof.map(hex),
    root: hex(b.root),
    expected: true,
  });
}

// A valid proof does not verify against a different batch's root.
const eight = batch(eightLabels, 3);
cases.push({
  name: 'valid proof against a different root is rejected',
  leaf: hex(eight.leaf),
  proof: eight.proof.map(hex),
  root: hex(live.root),
  expected: false,
});

// Reordering a proof breaks it, because each step feeds the next.
const reordered = [...eight.proof].reverse().map(hex);
cases.push({
  name: 'reordered proof is rejected',
  leaf: hex(eight.leaf),
  proof: reordered,
  root: hex(eight.root),
  expected: false,
  note: 'Proof order is leaf-to-root and is not commutative across levels.',
});

// Truncating a proof breaks it.
cases.push({
  name: 'truncated proof is rejected',
  leaf: hex(eight.leaf),
  proof: eight.proof.slice(0, -1).map(hex),
  root: hex(eight.root),
  expected: false,
});

const fixture = {
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
    root: hex(live.root),
    note: 'The first two cases below are the batch anchored on-chain.',
  },
  cases: cases.map((c) => (c.note === undefined ? (delete c.note, c) : c)),
};

const here = dirname(fileURLToPath(import.meta.url));

const jsonPath = join(here, '..', 'merkle-vectors.json');
writeFileSync(jsonPath, JSON.stringify(fixture, null, 2) + '\n');
console.log(`wrote ${jsonPath} (${fixture.cases.length} cases)`);

// Also emit the same vectors as Rust, so the Soroban contract tests run against
// byte-identical data without needing a JSON parser in a no_std crate. Copy the
// output to accensa-contracts/contracts/receipt-anchor/src/vectors.rs.
const bytes = (h) => `[${h.match(/../g).map((b) => `0x${b}`).join(', ')}]`;

const rust = `// GENERATED FILE — do not edit by hand.
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
${cases
  .map(
    (c) => `    Vector {
        name: ${JSON.stringify(c.name)},
        leaf: ${bytes(c.leaf)},
        proof: &[${c.proof.length ? '\n' + c.proof.map((p) => `            ${bytes(p)},`).join('\n') + '\n        ' : ''}],
        root: ${bytes(c.root)},
        expected: ${c.expected},
    },`,
  )
  .join('\n')}
];
`;

const rustPath = join(here, '..', 'vectors.rs');
writeFileSync(rustPath, rust);
console.log(`wrote ${rustPath}`);
