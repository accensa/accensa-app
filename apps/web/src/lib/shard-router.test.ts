import { describe, it, expect } from 'vitest';
import { pickShard, shardsFromEnv, resolveShard, type ShardConfig } from './shard-router';

const SHARDS: ShardConfig[] = [
  { id: 'shard-0', connectionString: 'postgres://shard-0' },
  { id: 'shard-1', connectionString: 'postgres://shard-1' },
  { id: 'shard-2', connectionString: 'postgres://shard-2' },
  { id: 'shard-3', connectionString: 'postgres://shard-3' },
];

function tenants(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `workspace-${i}`);
}

describe('pickShard', () => {
  it('is deterministic for the same tenant and shard list', () => {
    const first = pickShard('workspace-42', SHARDS);
    const second = pickShard('workspace-42', SHARDS);
    expect(second.id).toBe(first.id);
  });

  it('picks different tenants across all configured shards, roughly evenly', () => {
    const ids = tenants(2000);
    const counts = new Map<string, number>(SHARDS.map((s) => [s.id, 0]));
    for (const id of ids) {
      const shard = pickShard(id, SHARDS);
      counts.set(shard.id, (counts.get(shard.id) ?? 0) + 1);
    }
    // Every shard gets picked, and no shard is wildly over- or
    // under-represented. 2000 tenants over 4 shards averages 500 each; allow
    // generous slack (250-750) since this only needs to prove the hash isn't
    // degenerate, not that it is perfectly uniform.
    for (const shard of SHARDS) {
      const count = counts.get(shard.id) ?? 0;
      expect(count).toBeGreaterThan(250);
      expect(count).toBeLessThan(750);
    }
  });

  it('only remaps roughly 1/N of tenants when a shard is added', () => {
    const ids = tenants(2000);
    const before = new Map(ids.map((id) => [id, pickShard(id, SHARDS).id]));

    const withFifthShard = [...SHARDS, { id: 'shard-4', connectionString: 'postgres://shard-4' }];
    const after = new Map(ids.map((id) => [id, pickShard(id, withFifthShard).id]));

    let moved = 0;
    for (const id of ids) {
      if (before.get(id) !== after.get(id)) moved++;
    }

    // Naive `hash % shardCount` reassigns the overwhelming majority of keys
    // on a shard-count change. Rendezvous hashing should only move the tenants
    // that land on the new shard - expect roughly 1/5 (~400 of 2000), and
    // assert it's nowhere near a full reshuffle.
    expect(moved).toBeGreaterThan(200);
    expect(moved).toBeLessThan(700);
  });

  it('only moves tenants that were on the removed shard when one is removed', () => {
    const ids = tenants(2000);
    const before = new Map(ids.map((id) => [id, pickShard(id, SHARDS).id]));

    const withoutLastShard = SHARDS.slice(0, -1);
    for (const id of ids) {
      const previous = before.get(id)!;
      const now = pickShard(id, withoutLastShard).id;
      if (previous !== 'shard-3') {
        // A tenant that wasn't on the removed shard must not move.
        expect(now).toBe(previous);
      }
    }
  });

  it('throws for an empty shard list', () => {
    expect(() => pickShard('workspace-1', [])).toThrow(/no shards/i);
  });

  it('throws for an empty tenant id', () => {
    expect(() => pickShard('', SHARDS)).toThrow(/tenantId/);
  });
});

describe('shardsFromEnv', () => {
  it('falls back to a single default shard from DATABASE_URL when unset', () => {
    const env = { DATABASE_URL: 'postgres://single' } as unknown as NodeJS.ProcessEnv;
    const shards = shardsFromEnv(env);
    expect(shards).toEqual([{ id: 'default', connectionString: 'postgres://single' }]);
  });

  it('throws when neither DATABASE_SHARDS nor DATABASE_URL is set', () => {
    expect(() => shardsFromEnv({} as unknown as NodeJS.ProcessEnv)).toThrow(
      /DATABASE_SHARDS|DATABASE_URL/,
    );
  });

  it('parses a valid DATABASE_SHARDS JSON array', () => {
    const env = {
      DATABASE_SHARDS: JSON.stringify(SHARDS),
    } as unknown as NodeJS.ProcessEnv;
    expect(shardsFromEnv(env)).toEqual(SHARDS);
  });

  it('rejects malformed JSON', () => {
    const env = { DATABASE_SHARDS: '{not json' } as unknown as NodeJS.ProcessEnv;
    expect(() => shardsFromEnv(env)).toThrow(/not valid JSON/);
  });

  it('rejects an empty array', () => {
    const env = { DATABASE_SHARDS: '[]' } as unknown as NodeJS.ProcessEnv;
    expect(() => shardsFromEnv(env)).toThrow(/non-empty/);
  });

  it('rejects entries missing id or connectionString', () => {
    const env = {
      DATABASE_SHARDS: JSON.stringify([{ id: 'shard-0' }]),
    } as unknown as NodeJS.ProcessEnv;
    expect(() => shardsFromEnv(env)).toThrow(/id.*connectionString|connectionString.*id/i);
  });

  it('rejects duplicate shard ids', () => {
    const env = {
      DATABASE_SHARDS: JSON.stringify([
        { id: 'shard-0', connectionString: 'a' },
        { id: 'shard-0', connectionString: 'b' },
      ]),
    } as unknown as NodeJS.ProcessEnv;
    expect(() => shardsFromEnv(env)).toThrow(/duplicate/i);
  });
});

describe('resolveShard', () => {
  it('composes shardsFromEnv and pickShard', () => {
    const env = { DATABASE_SHARDS: JSON.stringify(SHARDS) } as unknown as NodeJS.ProcessEnv;
    const resolved = resolveShard('workspace-7', env);
    expect(resolved).toEqual(pickShard('workspace-7', SHARDS));
  });

  it('routes every tenant to the same default shard when DATABASE_SHARDS is unset', () => {
    const env = { DATABASE_URL: 'postgres://single' } as unknown as NodeJS.ProcessEnv;
    expect(resolveShard('workspace-a', env).id).toBe('default');
    expect(resolveShard('workspace-b', env).id).toBe('default');
  });
});
