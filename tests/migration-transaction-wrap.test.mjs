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

test('validateMigrationTransactionWrap detects missing COMMIT', () => {
  const mockSql = `
    -- Header comment
    BEGIN;
    CREATE TABLE test (id int);
  `;
  const result = validateMigrationTransactionWrap('mock.sql', mockSql);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes('Missing COMMIT; at end'));
});

test('validateMigrationTransactionWrap detects missing BEGIN', () => {
  const mockSql = `
    -- Header comment
    CREATE TABLE test (id int);
    COMMIT;
  `;
  const result = validateMigrationTransactionWrap('mock.sql', mockSql);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes('Missing BEGIN; at start'));
});
