import { expect, test, describe, beforeEach, vi, afterEach } from 'vitest';
import { logger, redact } from './log';

describe('Structured logger redaction', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('redacts specific keys from objects', () => {
    const input = {
      safe_key: 'hello',
      DATABASE_URL: 'postgres://user:pass@host/db',
      nested: {
        cron_secret: 'super-secret',
        other: 123,
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = redact(input) as any;
    expect(result.DATABASE_URL).toBe('[REDACTED]');
    expect(result.safe_key).toBe('hello');
    expect(result.nested.cron_secret).toBe('[REDACTED]');
    expect(result.nested.other).toBe(123);
  });

  test('redacts actual environment variable values when they appear in strings', () => {
    process.env.DATABASE_URL = 'postgres://secret-db-url';

    const input = {
      message: 'Failed to connect to postgres://secret-db-url inside string',
    };

    const result = redact(input) as Record<string, unknown>;
    expect(result.message).toBe('Failed to connect to [REDACTED] inside string');
  });

  test('logger outputs valid JSON', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.info('Test message', { req_id: '123' });

    expect(consoleSpy).toHaveBeenCalledOnce();
    const output = consoleSpy.mock.calls[0][0];

    const parsed = JSON.parse(output as string);
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('Test message');
    expect(parsed.req_id).toBe('123');
    expect(parsed.timestamp).toBeDefined();

    consoleSpy.mockRestore();
  });
});
