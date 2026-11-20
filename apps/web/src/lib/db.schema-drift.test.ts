/**
 * Detects drift between the hand-maintained ensureSchema (db.ts:89) and the
 * numbered SQL migration files in migrations/.
 *
 * Past drift example: idx_payments_hook_reported lived only in migrations/002,
 * never in ensureSchema — the same kind of omission this test catches.
 *
 * Both sources are applied to isolated schemas so the comparison is clean and
 * the production database is never touched.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Client } from 'pg';
import { withClient, ensureSchema } from './db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// migrations/ is four levels up from apps/web/src/lib/
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../migrations');

type ColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
};

async function schemaColumns(client: Client, schema: string): Promise<ColumnRow[]> {
  const res = await client.query<ColumnRow>(
    `SELECT table_name, column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = $1
     ORDER BY table_name, column_name`,
    [schema],
  );
  return res.rows;
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;

  await withClient(async (client) => {
    await client.query('DROP SCHEMA IF EXISTS migrated CASCADE');
    await client.query('DROP SCHEMA IF EXISTS code CASCADE');
    await client.query('CREATE SCHEMA migrated');
    await client.query('CREATE SCHEMA code');

    // Apply every migration in filename order inside the migrated schema
    await client.query('SET search_path TO migrated, public');
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf-8');
      await client.query(sql);
    }

    // Provision the code schema using ensureSchema
    await client.query('SET search_path TO code, public');
    await ensureSchema(client);

    await client.query('RESET search_path');
  });
});

afterAll(async () => {
  if (!process.env.DATABASE_URL) return;
  await withClient(async (client) => {
    await client.query('DROP SCHEMA IF EXISTS migrated CASCADE');
    await client.query('DROP SCHEMA IF EXISTS code CASCADE');
  });
});

describe('ensureSchema vs migrations column parity', () => {
  it('every column in the migrations schema is present in the ensureSchema schema', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping schema-drift integration test: DATABASE_URL not set');
      return;
    }

    await withClient(async (client) => {
      const migrated = await schemaColumns(client, 'migrated');
      const code = await schemaColumns(client, 'code');

      const codeKeys = new Set(code.map((r) => `${r.table_name}.${r.column_name}`));
      const migratedKeys = new Set(migrated.map((r) => `${r.table_name}.${r.column_name}`));

      const missingFromCode = migrated.filter(
        (r) => !codeKeys.has(`${r.table_name}.${r.column_name}`),
      );
      const missingFromMigrated = code.filter(
        (r) => !migratedKeys.has(`${r.table_name}.${r.column_name}`),
      );

      const fmtMissing = (rows: ColumnRow[]) =>
        rows.map((r) => `  ${r.table_name}.${r.column_name} (${r.data_type})`).join('\n');

      const msgMigrationsOnly =
        `Columns in migrations/ but absent from ensureSchema:\n` + fmtMissing(missingFromCode);
      const msgCodeOnly =
        `Columns in ensureSchema but absent from migrations/:\n` + fmtMissing(missingFromMigrated);

      expect(missingFromCode, msgMigrationsOnly).toEqual([]);
      expect(missingFromMigrated, msgCodeOnly).toEqual([]);
    });
  });
});
