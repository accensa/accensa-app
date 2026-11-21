import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { ensureSchema, withClient, withTenantClient } from './db';
import { resolveShard } from './shard-router';

/**
 * Connection targets `pg` was opened with, in call order.
 *
 * SHARDING.md promises `withTenantClient` is a no-op change until
 * `DATABASE_SHARDS` is set: with it unset it must resolve to the same
 * database `withClient` uses, and with one shard entry it must route
 * elsewhere. Recording the connectionString each mocked Client was built
 * with is what proves both halves against the same code path.
 */
const opened = vi.hoisted(() => [] as string[]);

vi.mock('pg', () => ({
  Client: class {
    readonly connectionString: string;

    constructor(config: { connectionString: string }) {
      this.connectionString = config.connectionString;
      opened.push(config.connectionString);
    }

    connect() {
      return Promise.resolve();
    }

    end() {
      return Promise.resolve();
    }

    query() {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
  },
}));

/** Records every statement `ensureSchema` issues, without a live Postgres. */
function recordingClient(): { client: Client; queries: string[] } {
  const queries: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      return { rows: [], rowCount: 0 };
    }),
  };
  return { client: client as unknown as Client, queries };
}

describe('withTenantClient', () => {
  beforeEach(() => {
    opened.length = 0;
    process.env.DATABASE_URL = 'postgres://primary';
    delete process.env.DATABASE_SHARDS;
  });

  afterEach(() => {
    delete process.env.DATABASE_SHARDS;
    process.env.DATABASE_URL = 'postgres://primary';
  });

  it('targets the same connection as withClient when DATABASE_SHARDS is unset', async () => {
    const viaWithClient = await withClient(async () => 'done');
    const viaTenantClient = await withTenantClient('workspace-42', async () => 'done');

    expect(viaWithClient).toBe('done');
    expect(viaTenantClient).toBe('done');
    expect(opened).toHaveLength(2);
    expect(opened[0]).toBe('postgres://primary');
    // SHARDING.md:70-74 — unset shards means the default shard is
    // DATABASE_URL, i.e. exactly withClient's target.
    expect(opened[1]).toBe(opened[0]);
  });

  it('routes elsewhere once a shard entry is configured, while withClient does not move', async () => {
    process.env.DATABASE_SHARDS = JSON.stringify([
      { id: 'shard-0', connectionString: 'postgres://shard-0' },
    ]);

    await withClient(async () => 'ignored');
    await withTenantClient('workspace-42', async () => 'ignored');

    // Existing call sites keep connecting to DATABASE_URL — no behaviour
    // change for any of them — while the tenant-aware path opens the shard.
    expect(opened[0]).toBe('postgres://primary');
    expect(opened[1]).toBe('postgres://shard-0');
    expect(opened[1]).not.toBe(opened[0]);
    // The connection comes from shard-router's resolution, not a second
    // source of truth.
    expect(opened[1]).toBe(resolveShard('workspace-42').connectionString);
  });

  it('fails loudly rather than silently defaulting when nothing is configured', async () => {
    delete process.env.DATABASE_URL;

    await expect(withClient(async () => 'x')).rejects.toThrow(/DATABASE_URL/);
    await expect(withTenantClient('workspace-42', async () => 'x')).rejects.toThrow(
      /DATABASE_SHARDS|DATABASE_URL/,
    );
    expect(opened).toHaveLength(0);
  });
});

describe('ensureSchema tenant shard column', () => {
  it("creates payments.workspace_id NOT NULL DEFAULT 'default', matching the migration", async () => {
    const { client, queries } = recordingClient();

    await ensureSchema(client);

    const columnDdl = queries.find((q) => q.includes('ADD COLUMN IF NOT EXISTS workspace_id'));
    expect(columnDdl).toBeDefined();
    expect(columnDdl).toContain("workspace_id VARCHAR(64) NOT NULL DEFAULT 'default'");
    expect(queries.join('\n')).toContain(
      'CREATE INDEX IF NOT EXISTS idx_payments_workspace_id ON payments(workspace_id)',
    );

    // The DEFAULT is what keeps every existing INSERT that omits the column
    // succeeding, and it is the same clause the standalone migration applies:
    // a restored database and an app-initialised one agree.
    const migration = readFileSync(
      new URL('../../../../migrations/006_tenant_shard_columns.sql', import.meta.url),
      'utf8',
    );
    expect(migration).toContain(
      "ALTER TABLE payments ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64) NOT NULL DEFAULT 'default';",
    );
  });
});
