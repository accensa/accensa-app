/**
 * Pins issue #526: apps/web/.env.example covers the variables the app reads,
 * and the root toolchain matches CI.
 *
 * README.md:120 is the hand-written DATABASE_URL sample. This test proves that
 * line is handled by the template (the variable is documented there) while the
 * prerequisites block at README.md:112 matches package.json and ci.yml.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = (relativePath) => readFileSync(new URL(relativePath, root), 'utf8');

const REQUIRED = ['DATABASE_URL', 'JWT_SECRET_KEY', 'CRON_SECRET'];

const OPTIONAL = [
  'NODE_ENV',
  'STELLAR_RPC_URL',
  'STELLAR_NETWORK_PASSPHRASE',
  'STELLAR_NETWORK',
  'NEXT_PUBLIC_STELLAR_NETWORK',
  'NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE',
  'NEXT_PUBLIC_STELLAR_RPC_URL',
  'ASSET_CONTRACT_IDS',
  'MERCHANT_ADDRESS',
  'MERCHANT_PUBLIC_KEY',
  'WEBHOOK_URL',
  'WEBHOOK_SECRET',
  'WEBHOOK_SIGNING_KEY',
  'HOOK_MAX_AGE_MS',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'SPICEDB_API_URL',
  'SPICEDB_API_TOKEN',
  'SPICEDB_PRESHARED_KEY',
  'SYNC_ALERT_WEBHOOK_URL',
  'SECURITY_ALERT_WEBHOOK_URL',
  'SYNC_LAG_WARN_LEDGERS',
  'SYNC_LAG_CRITICAL_LEDGERS',
  'SYNC_STALE_MS',
  'FACILITATOR_URL',
  'CSV_EXPORT_MAX_ROWS',
  'LOG_LEVEL',
  'NEXT_PUBLIC_SENTRY_DSN',
  'SENTRY_TRACES_SAMPLE_RATE',
  'NEXT_PUBLIC_REFUND_VAULT_ID',
  'NEXT_PUBLIC_RECEIPT_ANCHOR_ID',
  'RECEIPT_ANCHOR_ABI_VERSION',
  'CI',
  'PLAYWRIGHT_PORT',
];

test('README prerequisites match the CI toolchain', () => {
  const readme = read('README.md').split(/\r?\n/);
  const prerequisitesIndex = readme.findIndex((line) => line.startsWith('Node 22+'));
  assert.ok(prerequisitesIndex > 0);
  const prerequisites = readme[prerequisitesIndex];
  assert.match(prerequisites, /Node 22\+/);
  assert.match(prerequisites, /pnpm 11\.28\.5/);
  assert.match(readme[prerequisitesIndex - 2] ?? '', /Prerequisites/);

  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.packageManager, 'pnpm@11.28.5');
  assert.match(pkg.engines.node, /22/);
  assert.match(pkg.engines.pnpm, /11\.28\.5/);

  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /version:\s*11\.28\.5/);
  assert.match(ci, /node-version:\s*'22'/);
});

test('apps/web/.env.example covers README.md:120 and every app env read', () => {
  const example = read('apps/web/.env.example');
  const readme = read('README.md').split(/\r?\n/);
  const sampleLine = readme.find((line) => line.startsWith('DATABASE_URL='));
  assert.ok(sampleLine, 'README must retain the DATABASE_URL sample line');
  assert.match(sampleLine, /^DATABASE_URL=/);
  assert.match(example, /^DATABASE_URL=$/m);

  for (const name of [...REQUIRED, ...OPTIONAL]) {
    assert.match(example, new RegExp(`^${name}=`, 'm'), `${name} missing from template`);
  }

  assert.match(example, /Excluded/);
  assert.match(example, /DATABASE_SHARDS/);

  const assigned = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)];
  for (const [, name, value] of assigned) {
    assert.equal(value, '', `${name} must be blank in the template`);
  }
});
