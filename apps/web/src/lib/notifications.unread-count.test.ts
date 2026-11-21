import { describe, it, expect, vi } from 'vitest';
import type { Client } from 'pg';
import { getUnreadNotificationCount } from './notifications';

function makeClient(rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async () => ({ rows, rowCount: rows.length }));
  return { query } as unknown as Client;
}

describe('getUnreadNotificationCount — fallback and coercion', () => {
  it('returns 0 for empty rows', async () => {
    const count = await getUnreadNotificationCount(makeClient([]), 1);
    expect(count).toBe(0);
    expect(Number.isFinite(count)).toBe(true);
  });

  it('returns 0 for a row that has no count key', async () => {
    const count = await getUnreadNotificationCount(makeClient([{}]), 1);
    expect(Number.isNaN(count)).toBe(false);
    expect(count).toBe(0);
  });

  it('returns 0 for a null count', async () => {
    const count = await getUnreadNotificationCount(makeClient([{ count: null }]), 1);
    expect(Number.isNaN(count)).toBe(false);
    expect(count).toBe(0);
    expect(typeof count).toBe('number');
  });

  it('returns 0 for an undefined count', async () => {
    const count = await getUnreadNotificationCount(makeClient([{ count: undefined }]), 1);
    expect(Number.isNaN(count)).toBe(false);
    expect(count).toBe(0);
    expect(typeof count).toBe('number');
  });

  it("parses '0' as 0", async () => {
    const count = await getUnreadNotificationCount(makeClient([{ count: '0' }]), 1);
    expect(count).toBe(0);
    expect(Number.isFinite(count)).toBe(true);
  });

  it("parses '00012' as 12", async () => {
    const count = await getUnreadNotificationCount(makeClient([{ count: '00012' }]), 1);
    expect(count).toBe(12);
  });

  it("parses ' 12 ' (with whitespace) as 12", async () => {
    const count = await getUnreadNotificationCount(makeClient([{ count: ' 12 ' }]), 1);
    expect(count).toBe(12);
  });

  it("parses '12' as 12", async () => {
    const count = await getUnreadNotificationCount(makeClient([{ count: '12' }]), 1);
    expect(count).toBe(12);
  });

  it('handles a large total and returns a finite number', async () => {
    const count = await getUnreadNotificationCount(makeClient([{ count: '999999' }]), 1);
    expect(count).toBe(999999);
    expect(Number.isFinite(count)).toBe(true);
  });
});
