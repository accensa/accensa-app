import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLUMN_PROVENANCE } from './trust-boundary.mjs';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
const readMigration = (name) => readFileSync(join(migrationsDir, name), 'utf8');

/** Column names from the `CREATE TABLE ... payments (...)` block. */
function baseColumns(sql) {
  const block = sql.match(/CREATE TABLE IF NOT EXISTS payments\s*\(([\s\S]*?)\n\);/);
  assert.ok(block, 'CREATE TABLE payments block not found in 001_unify_payments.sql');
  return block[1]
    .split('\n')
    .map((line) => line.trim().replace(/--.*$/, '').trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[0].toLowerCase())
    .filter((token) => !['primary', 'unique', 'constraint', 'foreign', 'check'].includes(token));
}

const baseCols = baseColumns(readMigration('001_unify_payments.sql'));
const allMigrationsSql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .map(readMigration)
  .join('\n');
// Declared columns: the base CREATE TABLE plus every ADD COLUMN, not mere word matches.
const declared = new Set(baseCols);
for (const m of allMigrationsSql.matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi)) {
  declared.add(m[1].toLowerCase());
}
const entryColumns = COLUMN_PROVENANCE.map((e) => e.column);

test('parser finds the base payments columns', () => {
  assert.equal(baseCols.length, 9, `parsed: ${baseCols.join(', ')}`);
});

test('every base payments column has exactly one provenance entry', () => {
  for (const col of baseCols) {
    const n = entryColumns.filter((c) => c === col).length;
    assert.equal(n, 1, `column "${col}" has ${n} provenance entries, expected 1`);
  }
});

test('every provenance entry names a column that exists in the migrations', () => {
  for (const col of entryColumns) {
    assert.ok(declared.has(col), `entry "${col}" is not declared in migrations/*.sql`);
  }
});

test('entry columns are unique and have valid provenance and a note', () => {
  assert.equal(new Set(entryColumns).size, entryColumns.length, 'duplicate column entries');
  for (const e of COLUMN_PROVENANCE) {
    assert.ok(
      ['chain', 'merchant-reported'].includes(e.provenance),
      `"${e.column}" has invalid provenance "${e.provenance}"`,
    );
    assert.ok(
      typeof e.note === 'string' && e.note.trim().length > 0,
      `"${e.column}" has an empty note`,
    );
  }
});
