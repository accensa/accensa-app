import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'migrations');
const README_PATH = join(MIGRATIONS_DIR, 'README.md');

function getMigrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

function parsePrefix(filename) {
  const match = filename.match(/^(\d{3})_/);
  return match ? parseInt(match[1], 10) : null;
}

export function validateMigrationOrder(files, readmeContent) {
  const errors = [];
  const prefixes = [];
  const seenPrefixes = new Set();

  for (const file of files) {
    const prefix = parsePrefix(file);
    if (prefix === null) {
      errors.push(`Invalid migration filename format: ${file}`);
      continue;
    }
    if (seenPrefixes.has(prefix)) {
      errors.push(
        `Duplicate migration prefix found: ${String(prefix).padStart(3, '0')} in ${file}`,
      );
    }
    seenPrefixes.add(prefix);
    prefixes.push(prefix);

    if (!readmeContent.includes(file)) {
      errors.push(`Migration file missing from migrations/README.md: ${file}`);
    }
  }

  for (let i = 0; i < prefixes.length; i++) {
    const expected = i + 1;
    if (prefixes[i] !== expected) {
      errors.push(
        `Gap in migration numbering at index ${i}: expected prefix ${String(expected).padStart(3, '0')}, found ${String(prefixes[i]).padStart(3, '0')}`,
      );
    }
  }

  return errors;
}

test('migration files have valid, unique, contiguous prefixes starting at 001', () => {
  const files = getMigrationFiles();
  assert.ok(files.length > 0, 'migrations directory must contain .sql files');

  const readme = readFileSync(README_PATH, 'utf-8');
  const errors = validateMigrationOrder(files, readme);

  assert.deepEqual(errors, [], `Validation errors: ${errors.join(', ')}`);
});

test('validateMigrationOrder detects duplicate prefixes', () => {
  const mockFiles = ['001_initial.sql', '002_first.sql', '002_second_duplicate.sql'];
  const readme = '001_initial.sql 002_first.sql 002_second_duplicate.sql';
  const errors = validateMigrationOrder(mockFiles, readme);

  assert.ok(
    errors.some((err) => err.includes('Duplicate migration prefix found: 002')),
    `Expected duplicate prefix error, got: ${JSON.stringify(errors)}`,
  );
});

test('validateMigrationOrder detects gaps in numbering sequence', () => {
  const mockFiles = ['001_initial.sql', '003_skipped_two.sql'];
  const readme = '001_initial.sql 003_skipped_two.sql';
  const errors = validateMigrationOrder(mockFiles, readme);

  assert.ok(
    errors.some((err) => err.includes('Gap in migration numbering')),
    `Expected gap error, got: ${JSON.stringify(errors)}`,
  );
});

test('validateMigrationOrder detects files missing from migrations/README.md', () => {
  const mockFiles = ['001_initial.sql', '002_second.sql'];
  const readme = '001_initial.sql only';
  const errors = validateMigrationOrder(mockFiles, readme);

  assert.ok(
    errors.some((err) =>
      err.includes('Migration file missing from migrations/README.md: 002_second.sql'),
    ),
    `Expected missing from README error, got: ${JSON.stringify(errors)}`,
  );
});
