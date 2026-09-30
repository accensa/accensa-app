import { describe, expect, it } from 'vitest';
import { overallHealth } from './healthChecker';

describe('overallHealth', () => {
  it('reports operational only when every configured service is operational', () => {
    expect(
      overallHealth({ rpc: 'operational', indexer: 'operational', relayer: 'operational' }),
    ).toBe('operational');
  });

  it('distinguishes degraded, unavailable, and unconfigured services', () => {
    expect(overallHealth({ rpc: 'degraded', indexer: 'operational', relayer: 'operational' })).toBe(
      'degraded',
    );
    expect(overallHealth({ rpc: 'unavailable', indexer: 'operational', relayer: 'unknown' })).toBe(
      'unavailable',
    );
    expect(overallHealth({ rpc: 'operational', indexer: 'operational', relayer: 'unknown' })).toBe(
      'unknown',
    );
  });
});
