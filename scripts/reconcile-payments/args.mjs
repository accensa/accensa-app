// Argument parsing and configuration resolution for the reconcile-payments CLI.
// Pure functions with no top-level side effects (issue #783).

export const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org';
export const DEFAULT_ASSET_CONTRACT_IDS =
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
/** Matches MAX_LOOKBACK in apps/web/src/app/api/sync/route.ts: the RPC's retention window. */
export const DEFAULT_LOOKBACK_LEDGERS = 100_000;

export function parseArgs(argv) {
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

export function usage() {
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

export function resolveConfig(args = {}, env = {}, defaults = {}) {
  const merchant = args.merchant ?? env.MERCHANT_ADDRESS ?? null;
  const rpcUrl = args.rpcUrl ?? env.STELLAR_RPC_URL ?? defaults.rpcUrl ?? DEFAULT_RPC_URL;
  const rawAssetIds =
    args.assetContractIds ??
    env.ASSET_CONTRACT_IDS ??
    defaults.assetContractIds ??
    DEFAULT_ASSET_CONTRACT_IDS;
  const assetContractIds = (typeof rawAssetIds === 'string' ? rawAssetIds : '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const databaseUrl = args.databaseUrl ?? env.DATABASE_URL ?? null;

  return {
    merchant,
    rpcUrl,
    assetContractIds,
    databaseUrl,
    fromLedger: args.fromLedger,
    toLedger: args.toLedger,
    out: args.out,
    format: args.format ?? 'text',
    help: Boolean(args.help),
  };
}
