import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseArgs,
  resolveConfig,
  usage,
  DEFAULT_RPC_URL,
  DEFAULT_ASSET_CONTRACT_IDS,
} from './args.mjs';
import { main } from './cli.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI_PATH = join(__dirname, 'cli.mjs');

test('parseArgs parses valid flags correctly', () => {
  const argv = [
    '--merchant',
    'GBZXABC123',
    '--rpc-url',
    'https://custom-rpc.com',
    '--asset-contract-ids',
    'CASSET1,CASSET2',
    '--from-ledger',
    '100',
    '--to-ledger',
    '200',
    '--database-url',
    'postgres://localhost/test',
    '--out',
    'report.json',
    '--format',
    'json',
  ];

  const args = parseArgs(argv);
  assert.equal(args.merchant, 'GBZXABC123');
  assert.equal(args.rpcUrl, 'https://custom-rpc.com');
  assert.equal(args.assetContractIds, 'CASSET1,CASSET2');
  assert.equal(args.fromLedger, 100);
  assert.equal(args.toLedger, 200);
  assert.equal(args.databaseUrl, 'postgres://localhost/test');
  assert.equal(args.out, 'report.json');
  assert.equal(args.format, 'json');
  assert.equal(args.help, undefined);
});

test('parseArgs recognizes --help and -h', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
});

test('parseArgs throws on unknown flag', () => {
  assert.throws(() => parseArgs(['--unknown-flag']), /Unknown argument: --unknown-flag/);
});

test('resolveConfig: flag wins over environment variable', () => {
  const args = {
    merchant: 'FLAG_MERCHANT',
    rpcUrl: 'https://flag-rpc.com',
    assetContractIds: 'FLAG_ASSET_1,FLAG_ASSET_2',
    databaseUrl: 'postgres://flag-db',
  };
  const env = {
    MERCHANT_ADDRESS: 'ENV_MERCHANT',
    STELLAR_RPC_URL: 'https://env-rpc.com',
    ASSET_CONTRACT_IDS: 'ENV_ASSET_1,ENV_ASSET_2',
    DATABASE_URL: 'postgres://env-db',
  };

  const resolved = resolveConfig(args, env);
  assert.equal(resolved.merchant, 'FLAG_MERCHANT');
  assert.equal(resolved.rpcUrl, 'https://flag-rpc.com');
  assert.deepEqual(resolved.assetContractIds, ['FLAG_ASSET_1', 'FLAG_ASSET_2']);
  assert.equal(resolved.databaseUrl, 'postgres://flag-db');
});

test('resolveConfig: environment wins over built-in default', () => {
  const args = {};
  const env = {
    MERCHANT_ADDRESS: 'ENV_MERCHANT',
    STELLAR_RPC_URL: 'https://env-rpc.com',
    ASSET_CONTRACT_IDS: 'ENV_ASSET_1,ENV_ASSET_2',
    DATABASE_URL: 'postgres://env-db',
  };

  const resolved = resolveConfig(args, env);
  assert.equal(resolved.merchant, 'ENV_MERCHANT');
  assert.equal(resolved.rpcUrl, 'https://env-rpc.com');
  assert.deepEqual(resolved.assetContractIds, ['ENV_ASSET_1', 'ENV_ASSET_2']);
  assert.equal(resolved.databaseUrl, 'postgres://env-db');
});

test('resolveConfig: falls back to built-in defaults when flag and env are absent', () => {
  const args = {};
  const env = {};

  const resolved = resolveConfig(args, env);
  assert.equal(resolved.merchant, null);
  assert.equal(resolved.rpcUrl, DEFAULT_RPC_URL);
  assert.deepEqual(
    resolved.assetContractIds,
    DEFAULT_ASSET_CONTRACT_IDS.split(',').map((s) => s.trim()),
  );
  assert.equal(resolved.databaseUrl, null);
});

test('main() with --help returns 0 without contacting network', async () => {
  const originalLog = console.log;
  let logged = '';
  console.log = (msg) => {
    logged += msg;
  };
  try {
    const code = await main(['--help'], {});
    assert.equal(code, 0);
    assert.ok(logged.includes('Usage: node cli.mjs --merchant G...'));
  } finally {
    console.log = originalLog;
  }
});

test('CLI exits with code 2 when merchant is missing from both argv and environment', () => {
  const proc = spawnSync('node', [CLI_PATH], {
    env: {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
    },
    encoding: 'utf-8',
  });

  assert.equal(proc.status, 2, `Expected exit status 2, got: ${proc.status}`);
  assert.ok(
    proc.stderr.includes('Error: --merchant (or MERCHANT_ADDRESS) is required.'),
    `stderr should include missing merchant error: ${proc.stderr}`,
  );
  assert.ok(
    proc.stderr.includes('Usage: node cli.mjs --merchant G...'),
    `stderr should include usage text: ${proc.stderr}`,
  );
});
