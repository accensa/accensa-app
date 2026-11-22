import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'migrations');

/**
 * Historical filename mapping from issue #777 to renumbered filenames (PR #852).
 * Colliding 003_ prefixes were renumbered to unique contiguous prefixes as documented
 * in migrations/README.md:
 * - 003_receipt_batches.sql -> 005_receipt_batches.sql
 * - 003_webhook_deliveries.sql -> 007_webhook_deliveries.sql
 */
export const HISTORICAL_MIGRATION_MAP = {
  '003_receipt_batches.sql': '005_receipt_batches.sql',
  '003_webhook_deliveries.sql': '007_webhook_deliveries.sql',
};

/**
 * Named exemptions for migrations that cannot run in a transaction
 * (for example, CREATE INDEX CONCURRENTLY or database creation).
 * Each entry must explain why transaction wrapping is not possible.
 */
export const TRANSACTION_EXEMPTIONS = new Set([
  // No migrations are currently exempt. All DDL migrations must be wrapped in transactions.
]);

/**
 * Extracts non-comment, non-empty statements/lines from a SQL migration file.
 */
export function extractSqlStatements(sqlContent) {
  return sqlContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('--'));
}

/**
 * Checks whether a migration file is properly wrapped in BEGIN; / COMMIT;.
 * Returns an object with { valid: boolean, error?: string }.
 */
export function validateMigrationTransactionWrap(filename, sqlContent) {
  if (TRANSACTION_EXEMPTIONS.has(filename)) {
    return { valid: true };
  }

  const statements = extractSqlStatements(sqlContent);
  if (statements.length === 0) {
    return { valid: false, error: 'Migration file is empty' };
  }

  const first = statements[0];
  const last = statements[statements.length - 1];

  const hasBegin = /^BEGIN\b/i.test(first);
  const hasCommit = /^COMMIT\b/i.test(last);

  if (!hasBegin && !hasCommit) {
    return {
      valid: false,
      error: `Missing both BEGIN; at start and COMMIT; at end (first: "${first}", last: "${last}")`,
    };
  }
  if (!hasBegin) {
    return {
      valid: false,
      error: `Missing BEGIN; at start (found "${first}")`,
    };
  }
  if (!hasCommit) {
    return {
      valid: false,
      error: `Missing COMMIT; at end (found "${last}")`,
    };
  }

  return { valid: true };
}

test('every migration file is wrapped in BEGIN; and COMMIT; (#777)', () => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  assert.ok(files.length > 0, 'migrations directory must contain .sql files');

  const failures = [];
  for (const file of files) {
    const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const result = validateMigrationTransactionWrap(file, content);
    if (!result.valid) {
      failures.push(`${file}: ${result.error}`);
    }
  }

  assert.deepEqual(failures, [], `Migrations not wrapped in transactions:\n${failures.join('\n')}`);
});

test('003_receipt_batches.sql (005_receipt_batches.sql) opens with BEGIN; and closes with COMMIT; (#777)', () => {
  const resolvedFile = HISTORICAL_MIGRATION_MAP['003_receipt_batches.sql'];
  const content = readFileSync(join(MIGRATIONS_DIR, resolvedFile), 'utf-8');
  const result = validateMigrationTransactionWrap('003_receipt_batches.sql', content);
  assert.equal(
    result.valid,
    true,
    `003_receipt_batches.sql (${resolvedFile}) must be wrapped in BEGIN; and COMMIT;`,
  );
});

test('003_webhook_deliveries.sql (007_webhook_deliveries.sql) opens with BEGIN; and closes with COMMIT; (#777)', () => {
  const resolvedFile = HISTORICAL_MIGRATION_MAP['003_webhook_deliveries.sql'];
  const content = readFileSync(join(MIGRATIONS_DIR, resolvedFile), 'utf-8');
  const result = validateMigrationTransactionWrap('003_webhook_deliveries.sql', content);
  assert.equal(
    result.valid,
    true,
    `003_webhook_deliveries.sql (${resolvedFile}) must be wrapped in BEGIN; and COMMIT;`,
  );
});

test('validateMigrationTransactionWrap detects missing COMMIT in 003_receipt_batches.sql', () => {
  const mockSql = `
    -- Mapping from an on-chain ReceiptAnchor batch to the payments that formed it.
    BEGIN;
    CREATE TABLE IF NOT EXISTS receipt_batches (selection_hash VARCHAR(64) PRIMARY KEY);
  `;
  const result = validateMigrationTransactionWrap('003_receipt_batches.sql', mockSql);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes('Missing COMMIT; at end'));
});

test('validateMigrationTransactionWrap detects missing BEGIN in 003_webhook_deliveries.sql', () => {
  const mockSql = `
    -- Outbound payment webhooks
    CREATE TABLE IF NOT EXISTS webhook_deliveries (id BIGSERIAL PRIMARY KEY);
    COMMIT;
  `;
  const result = validateMigrationTransactionWrap('003_webhook_deliveries.sql', mockSql);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes('Missing BEGIN; at start'));
});
