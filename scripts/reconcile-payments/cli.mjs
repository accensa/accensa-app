#!/usr/bin/env node
// Standalone CLI: rebuild the ledger-derived `payments` columns from Stellar
// chain data, and - when a database is provided - diff them against
// production. See README.md for the two ways this is meant to be run:
//
//   1. Rebuild-only, by anyone, with no Accensa infrastructure access:
//        node cli.mjs --merchant G... --from-ledger 123456
//
//   2. Rebuild + diff against production, run by us in CI on a schedule:
//        node cli.mjs --merchant G... --from-ledger 123456 --database-url $DATABASE_URL
//
// This file is intentionally the only place in the package that touches
// process.argv, process.env or process.exit, so rebuild.mjs / diff.mjs /
// db.mjs stay plain, unit-testable functions.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { rebuildFromChain } from './rebuild.mjs';
import { fetchProductionPayments } from './db.mjs';
import { diffPayments } from './diff.mjs';
import { renderTrustBoundary, EXCLUDED_COLUMNS } from './trust-boundary.mjs';
import {
  parseArgs,
  usage,
  resolveConfig,
  DEFAULT_RPC_URL,
  DEFAULT_ASSET_CONTRACT_IDS,
  DEFAULT_LOOKBACK_LEDGERS,
} from './args.mjs';

export {
  parseArgs,
  usage,
  resolveConfig,
  DEFAULT_RPC_URL,
  DEFAULT_ASSET_CONTRACT_IDS,
  DEFAULT_LOOKBACK_LEDGERS,
};

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const config = resolveConfig(args, env);
  const { merchant, rpcUrl, assetContractIds, databaseUrl } = config;

  if (!merchant) {
    console.error('Error: --merchant (or MERCHANT_ADDRESS) is required.\n');
    console.error(usage());
    return 2;
  }

  console.error(`Rebuilding payments for ${merchant} from ${rpcUrl}...`);
  const latestGuess = args.toLedger;
  const fromLedger =
    args.fromLedger ??
    (await (async () => {
      const { getLatestLedger } = await import('./rpc.mjs');
      const latest = latestGuess ?? (await getLatestLedger(rpcUrl));
      return Math.max(1, latest - DEFAULT_LOOKBACK_LEDGERS);
    })());

  const { rows: rebuilt, toLedger } = await rebuildFromChain(
    { rpcUrl, merchant, assetContractIds, fromLedger, toLedger: args.toLedger },
    {
      onProgress: ({ windowStart, windowEnd, toLedger: total }) =>
        console.error(`  scanned ledgers ${windowStart}-${windowEnd} of ${total}`),
    },
  );
  console.error(
    `Rebuilt ${rebuilt.size} transfer(s) to ${merchant} in [${fromLedger}, ${toLedger}].`,
  );

  const report = {
    merchant,
    rpcUrl,
    assetContractIds,
    fromLedger,
    toLedger,
    reconstructedRowCount: rebuilt.size,
    mode: databaseUrl ? 'diff' : 'rebuild-only',
  };

  if (!databaseUrl) {
    report.rows = [...rebuilt.values()];
    printReport(report, args);
    if (args.out) await writeFile(args.out, JSON.stringify(report, null, 2));
    console.log(
      '\nRebuild-only mode: no DATABASE_URL given, so no diff against production was run.',
    );
    console.log('This is the mode intended for a third party independently verifying this data.');
    return 0;
  }

  console.error('Fetching production payments for diff...');
  const production = await fetchProductionPayments(databaseUrl);
  const diff = diffPayments(rebuilt, production);
  report.diff = diff;

  printReport(report, args);
  if (args.out) await writeFile(args.out, JSON.stringify(report, null, 2));

  return diff.ok ? 0 : 1;
}

function printReport(report, args) {
  if (args.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('');
  console.log('='.repeat(72));
  console.log(`Payments reconciliation for ${report.merchant}`);
  console.log(`Ledger range: [${report.fromLedger}, ${report.toLedger}]`);
  console.log(`Mode: ${report.mode}`);
  console.log('='.repeat(72));
  console.log('');
  console.log(renderTrustBoundary());
  console.log('');
  console.log(`These columns are never reconstructed or compared: ${EXCLUDED_COLUMNS.join(', ')}.`);

  if (!report.diff) return;

  const { matched, mismatched, missingInDb, missingOnChain, pendingOnChain, ok } = report.diff;
  console.log('');
  console.log('-'.repeat(72));
  console.log(`Matched:              ${matched}`);
  console.log(`Mismatched:           ${mismatched.length}`);
  console.log(`Missing in database:  ${missingInDb.length}  (on chain, absent from \`payments\`)`);
  console.log(
    `Missing on chain:     ${missingOnChain.length}  (in \`payments\` with a ledger, unseen by this rebuild)`,
  );
  console.log(
    `Pending on chain:     ${pendingOnChain.length}  (merchant-staged rows awaiting indexing - not a failure)`,
  );
  console.log('-'.repeat(72));

  if (mismatched.length) {
    console.log('\nMISMATCHED ROWS (row-level; a matching count does not mean these agree):');
    for (const row of mismatched) {
      console.log(`  ${row.tx_hash}`);
      for (const [col, { chain, db }] of Object.entries(row.columns)) {
        console.log(`    ${col}: chain=${JSON.stringify(chain)} db=${JSON.stringify(db)}`);
      }
    }
  }
  if (missingInDb.length) {
    console.log('\nON CHAIN BUT MISSING FROM `payments`:');
    for (const row of missingInDb) console.log(`  ${row.tx_hash} (ledger ${row.chain.ledger})`);
  }
  if (missingOnChain.length) {
    console.log('\nIN `payments` WITH A LEDGER, BUT NOT SEEN BY THIS REBUILD:');
    for (const row of missingOnChain) console.log(`  ${row.tx_hash} (db ledger ${row.db.ledger})`);
  }

  console.log('');
  console.log(ok ? 'RESULT: reconciled - no discrepancy.' : 'RESULT: DISCREPANCY FOUND.');
}

const isDirectExecution =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error('Reconciliation failed:', error);
      process.exit(2);
    });
}
