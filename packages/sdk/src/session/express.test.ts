import { describe, expect, it } from 'vitest';
import { canSpendExpress } from './express';

describe('canSpendExpress', () => {
  it('allows an amount within the remaining allowance using exact decimal arithmetic', () => {
    expect(canSpendExpress('0.2', { spent: '0.1', limit: '0.3' })).toBe(true);
  });

  it('rejects spending beyond the limit, zero amounts, and malformed values', () => {
    const allowance = { spent: '0.2', limit: '0.3' };
    expect(canSpendExpress('0.1000001', allowance)).toBe(false);
    expect(canSpendExpress('0', allowance)).toBe(false);
    expect(canSpendExpress('1e-7', allowance)).toBe(false);
  });
});
