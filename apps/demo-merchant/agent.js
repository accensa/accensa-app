#!/usr/bin/env node
/**
 * The other half of the demo — an agent that pays.
 *
 * `server.js` is the seller: it puts x402 payment middleware in front of its
 * routes and waits. This script is the buyer: it walks one of those routes
 * through the whole protocol — plain request, 402 Payment Required, signed
 * payment payload, retry, resource, settlement — printing each step so a
 * reader can follow what the protocol did. It uses the stock x402 client
 * (`x402Client` + `x402HTTPClient`) rather than a hand-rolled payer.
 *
 * It then ends with something usable: a receipt in exactly the form the
 * dashboard's `/verify` page accepts (batchId, leaf, proof), built over the
 * payments this run actually made. The proof is a real sorted-pair Merkle
 * proof, so the receipt is genuinely verifiable with `@accensa/sdk`'s
 * `verifyReceipt`. Whether the containing batch is anchored on-chain is a
 * separate step (accensa-app issue #15); until then the on-chain half of
 * `/verify` will report the batch as unknown while the local half still
 * recomputes the root from the proof.
 *
 * Setup (see README.md for the full walkthrough):
 *   1. Fund a testnet payer and put its secret key in STELLAR_PRIVATE_KEY.
 *   2. Start the demo merchant (node server.js) with MERCHANT_ADDRESS set.
 *   3. Run this script:  node agent.js
 *
 * Environment:
 *   STELLAR_PRIVATE_KEY  payer's Ed25519 secret key (required)
 *   MERCHANT_URL         defaults to http://localhost:3001
 *   ROUTES               comma-separated routes to pay; defaults to
 *                        /api/hello,/api/insights/daily — two different prices,
 *                        so the receipt batch has more than one leaf and the
 *                        proof is non-empty (the /verify form requires at
 *                        least one sibling hash).
 *   STELLAR_RPC_URL      Soroban RPC; defaults to the testnet endpoint.
 */
import { createHash } from 'node:crypto';
import 'dotenv/config';
import { createPayer, payForResource } from './lib/x402-payer.js';

const MERCHANT_URL = (process.env.MERCHANT_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const ROUTES = (process.env.ROUTES ?? '/api/hello,/api/insights/daily')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const RPC_URL = process.env.STELLAR_RPC_URL;

const PRIVATE_KEY = process.env.STELLAR_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('❌ STELLAR_PRIVATE_KEY is not set. Fund a testnet payer first — see README.md.');
  process.exit(1);
}

/**
 * A receipt leaf in the Accensa convention: the SHA-256 of a receipt label
 * string (payment hash + metadata), matching the leaves the ReceiptAnchor
 * contract anchors and `@accensa/sdk`'s verifyReceipt expects.
 */
function receiptLeaf(txHash, amount, route) {
  return createHash('sha256').update(`accensa:receipt:${txHash}:${amount}:${route}`).digest('hex');
}

/** Combines two nodes smaller-hash-first, exactly like the SDK/contract. */
function combine(a, b) {
  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');
  const [lo, hi] = Buffer.compare(aBuf, bBuf) <= 0 ? [aBuf, bBuf] : [bBuf, aBuf];
  return createHash('sha256')
    .update(Buffer.concat([lo, hi]))
    .digest('hex');
}

/**
 * Builds a sorted-pair Merkle batch over the given leaves and returns the
 * membership proof for the leaf at `index` (leaf-to-root order), mirroring the
 * conformance convention in packages/sdk/merkle-vectors.json.
 */
function proofFor(leaves, index) {
  let level = leaves.slice();
  const proof = [];
  let i = index;
  while (level.length > 1) {
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < level.length) proof.push(level[sibling]);
    const next = [];
    for (let j = 0; j < level.length; j += 2) {
      next.push(j + 1 < level.length ? combine(level[j], level[j + 1]) : level[j]);
    }
    level = next;
    i = Math.floor(i / 2);
  }
  return proof;
}

async function main() {
  console.log(`Agent payer: ${process.env.STELLAR_PRIVATE_KEY ? 'configured' : 'missing'}`);
  console.log(`Target merchant: ${MERCHANT_URL}`);
  console.log(`Routes to pay: ${ROUTES.join(', ')}`);
  console.log('');

  const { client, httpClient } = createPayer(PRIVATE_KEY, RPC_URL);
  const payments = [];

  for (const route of ROUTES) {
    const url = `${MERCHANT_URL}${route}`;
    console.log(`━━━ Paying ${route} ━━━`);
    const result = await payForResource(client, httpClient, url, (step, detail) => {
      console.log(`  ${step}`);
      if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`);
    });

    if (!result.paid) {
      console.log(`  (not an x402-gated route — status ${result.status})`);
      console.log(`  ${result.body}`);
      console.log('');
      continue;
    }

    if (result.status !== 200 || !result.settlement?.success) {
      console.error(`❌ Payment for ${route} did not settle:`);
      console.error(`   status=${result.status}`);
      console.error(`   settlement=${JSON.stringify(result.settlement)}`);
      console.error(`   body=${result.body}`);
      process.exit(1);
    }

    const txHash = result.settlement.transaction;
    const amount = result.settlement.amount ?? result.paymentRequired?.accepts?.[0]?.amount ?? '?';
    payments.push({ route, txHash, amount, body: result.body });
    console.log(`✅ Got the resource: ${result.body}`);
    console.log('');
  }

  if (payments.length === 0) {
    console.error('No payments were made; nothing to show.');
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // Receipt — in exactly the form /verify accepts: batchId, leaf, proof.
  // -------------------------------------------------------------------------
  console.log('━━━ Receipt ━━━');
  const leaves = payments.map((p) => receiptLeaf(p.txHash, p.amount, p.route));
  console.log(
    `Built a ${payments.length}-leaf batch over this run's payments (sorted-pair SHA-256).`,
  );

  // Print a receipt for the first payment; the batch root and every leaf are
  // also printed so the reader can paste the receipt into /verify.
  const target = 0;
  const proof = proofFor(leaves, target);
  const batchRoot = batchRootFor(leaves);

  const p = payments[target];
  console.log('');
  console.log(`Receipt for ${p.route} (tx ${p.txHash}):`);
  console.log(`  batchId: 1`);
  console.log(`  leaf:    ${leaves[target]}`);
  console.log(`  proof:   ${proof.join(' ')}`);
  console.log(`  root:    ${batchRoot}`);
  console.log('');
  console.log('Paste the batchId, leaf and proof into the dashboard /verify page.');
  console.log('The local Merkle check recomputes this exact root from the proof;');
  console.log('the on-chain check needs the batch anchored (accensa-app issue #15).');
}

/** Root of a sorted-pair Merkle batch (promoted odd nodes, SDK convention). */
function batchRootFor(leaves) {
  let level = leaves.slice();
  while (level.length > 1) {
    const next = [];
    for (let j = 0; j < level.length; j += 2) {
      next.push(j + 1 < level.length ? combine(level[j], level[j + 1]) : level[j]);
    }
    level = next;
  }
  return level[0];
}

main().catch((error) => {
  console.error('Agent failed:', error.message);
  process.exit(1);
});
