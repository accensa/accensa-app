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
import { rebuildFromChain } from './rebuild.mjs';
import { fetchProductionPayments } from './db.mjs';
import { diffPayments } from './diff.mjs';
import { renderTrustBoundary, EXCLUDED_COLUMNS } from './trust-boundary.mjs';

const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org';
const DEFAULT_ASSET_CONTRACT_IDS = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
/** Matches MAX_LOOKBACK in apps/web/src/app/api/sync/route.ts: the RPC's retention window. */
const DEFAULT_LOOKBACK_LEDGERS = 100_000;

function parseArgs(argv) {
  const args = { format: 'text' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--merchant':
        args.merchant = next();
        break;
      case '--rpc-url':
        args.rpcUrl = next();
        break;
      case '--asset-contract-ids':
        args.assetContractIds = next();
        break;
      case '--from-ledger':
        args.fromLedger = Number(next());
        break;
      case '--to-ledger':
        args.toLedger = Number(next());
        break;
      case '--database-url':
        args.databaseUrl = next();
        break;
      case '--out':
        args.out = next();
        break;
      case '--format':
        args.format = next();
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return `Usage: node cli.mjs --merchant G... [options]

  --merchant <G...>            Merchant Stellar account address. Required. Also read
                                from MERCHANT_ADDRESS.
  --rpc-url <url>               Soroban RPC endpoint. Default: ${DEFAULT_RPC_URL}
                                 (or STELLAR_RPC_URL)
  --asset-contract-ids <ids>    Comma-separated SAC contract IDs. Default matches
                                 apps/web's default (or ASSET_CONTRACT_IDS)
  --from-ledger <n>             First ledger to scan. Default: latest - ${DEFAULT_LOOKBACK_LEDGERS}
  --to-ledger <n>                Last ledger to scan. Default: latest
  --database-url <url>          Postgres connection string for production \`payments\`.
                                 When omitted, this runs in rebuild-only mode: no
                                 database is contacted and no diff is produced - this
                                 is the mode a third party runs with no access to our
                                 infrastructure. (or DATABASE_URL)
  --out <path>                  Write the full JSON report to this file.
  --format <text|json>          Report format on stdout. Default: text.
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const merchant = args.merchant ?? process.env.MERCHANT_ADDRESS;
  if (!merchant) {
    console.error('Error: --merchant (or MERCHANT_ADDRESS) is required.\n');
    console.error(usage());
    return 2;
  }

  const rpcUrl = args.rpcUrl ?? process.env.STELLAR_RPC_URL ?? DEFAULT_RPC_URL;
  const assetContractIds = (
    args.assetContractIds ??
    process.env.ASSET_CONTRACT_IDS ??
    DEFAULT_ASSET_CONTRACT_IDS
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const databaseUrl = args.databaseUrl ?? process.env.DATABASE_URL;

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

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('Reconciliation failed:', error);
    process.exit(2);
  });
