#!/usr/bin/env node
/**
 * Populates the dashboard with a realistic mix of payments in one command.
 *
 * The demo merchant serves several routes at deliberately different prices.
 * This driver hits each of them the way a real agent would — the cheap route
 * often, the mid route occasionally, the expensive route rarely — plus the
 * free route, so a reviewer who opens the dashboard sees more than one value
 * in the route column and per-route totals that actually differ.
 *
 * Setup (see README.md for the full walkthrough):
 *   1. Fund a testnet payer and put its secret key in STELLAR_PRIVATE_KEY.
 *   2. Start the demo merchant (node server.js) with MERCHANT_ADDRESS set.
 *   3. Point ACCENSA_URL at your Accensa deployment so the merchant's
 *      settlement reports land in the dashboard (the merchant reads it from
 *      its own ACCENSA_URL env var).
 *   4. Run this script:  node drive.js
 *
 * Environment:
 *   STELLAR_PRIVATE_KEY  payer's Ed25519 secret key (required)
 *   MERCHANT_URL         defaults to http://localhost:3001
 *   STELLAR_RPC_URL      Soroban RPC; defaults to the testnet endpoint.
 */
import 'dotenv/config';
import { createPayer, payForResource } from './lib/x402-payer.js';

const MERCHANT_URL = (process.env.MERCHANT_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const RPC_URL = process.env.STELLAR_RPC_URL;

const PRIVATE_KEY = process.env.STELLAR_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('❌ STELLAR_PRIVATE_KEY is not set. Fund a testnet payer first — see README.md.');
  process.exit(1);
}

/**
 * The mix this driver makes. Cheap and frequent, expensive and rare — a
 * realistic call pattern, and one that gives the dashboard's per-route
 * attribution and totals something to differ over.
 */
const MIX = [
  { route: '/api/hello', count: 5 },
  { route: '/api/insights/daily', count: 2 },
  { route: '/api/analytics/full', count: 1 },
  { route: '/api/free', count: 3 },
];

async function main() {
  console.log(`Driving ${MERCHANT_URL} with:`);
  for (const { route, count } of MIX) {
    console.log(`  ${count}× ${route}`);
  }
  console.log('');

  const { client, httpClient } = createPayer(PRIVATE_KEY, RPC_URL);
  const summary = [];

  for (const { route, count } of MIX) {
    const url = `${MERCHANT_URL}${route}`;
    let ok = 0;
    for (let i = 0; i < count; i++) {
      try {
        const result = await payForResource(client, httpClient, url);
        // Free route: 200 with no settlement. Paid routes: 200 + success.
        const settled = result.paid
          ? result.status === 200 && result.settlement?.success
          : result.status === 200;
        if (settled) ok++;
        else console.error(`  ⚠️  ${route} call ${i + 1} returned ${result.status}`);
      } catch (error) {
        console.error(`  ⚠️  ${route} call ${i + 1} failed: ${error.message}`);
      }
    }
    summary.push({ route, attempted: count, ok });
    console.log(`  ${route}: ${ok}/${count} calls succeeded`);
  }

  const failed = summary.some((s) => s.ok < s.attempted);
  console.log('');
  console.log('Done. Refresh the Accensa dashboard to see per-route revenue.');
  if (failed) {
    console.warn('Some calls failed — check that the merchant is running with MERCHANT_ADDRESS');
    console.warn('set and a funded payer is configured (see README.md).');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Driver failed:', error.message);
  process.exit(1);
});
