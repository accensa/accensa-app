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

describe('LOG_LEVEL resolution (#624)', () => {
  const originalEnv = process.env;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env = originalEnv;
  });

  test('resolves to info with no warning when LOG_LEVEL is unset', async () => {
    delete process.env.LOG_LEVEL;
    const { getLogLevel, LOG_LEVELS } = await import('./log');

    expect(getLogLevel()).toBe(LOG_LEVELS.info);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('resolves to info with no warning when LOG_LEVEL is empty string', async () => {
    process.env.LOG_LEVEL = '';
    const { getLogLevel, LOG_LEVELS } = await import('./log');

    expect(getLogLevel()).toBe(LOG_LEVELS.info);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('resolves each valid level without warning', async () => {
    const validLevels = [
      { name: 'debug', expected: 10 },
      { name: 'info', expected: 20 },
      { name: 'warn', expected: 30 },
      { name: 'error', expected: 40 },
    ];

    for (const { name, expected } of validLevels) {
      vi.resetModules();
      process.env.LOG_LEVEL = name;
      const { getLogLevel } = await import('./log');

      expect(getLogLevel()).toBe(expected);
      expect(warnSpy).not.toHaveBeenCalled();
    }
  });

  test('resolves mixed-case valid levels without warning', async () => {
    const mixedLevels = [
      { input: 'Debug', expected: 10 },
      { input: 'INFO', expected: 20 },
      { input: 'WaRn', expected: 30 },
      { input: 'eRrOr', expected: 40 },
    ];

    for (const { input, expected } of mixedLevels) {
      vi.resetModules();
      process.env.LOG_LEVEL = input;
      const { getLogLevel } = await import('./log');

      expect(getLogLevel()).toBe(expected);
      expect(warnSpy).not.toHaveBeenCalled();
    }
  });

  test('rejects unrecognised values, warns once with JSON.stringify, and defaults to info', async () => {
    process.env.LOG_LEVEL = 'verbose';
    const { getLogLevel, LOG_LEVELS, ACCEPTED_LOG_LEVELS } = await import('./log');

    expect(getLogLevel()).toBe(LOG_LEVELS.info);
    expect(warnSpy).toHaveBeenCalledOnce();

    const warning = warnSpy.mock.calls[0][0] as string;
    expect(warning).toContain('"verbose"');
    expect(warning).toContain(ACCEPTED_LOG_LEVELS.join(', '));
    expect(warning).toContain('defaulting to info');
    expect(warning.includes('\n')).toBe(false);
  });

  test('rejects inherited property names (constructor, toString, __proto__) and warns', async () => {
    const inheritedProps = ['constructor', 'toString', '__proto__', 'valueOf'];

    for (const prop of inheritedProps) {
      vi.resetModules();
      warnSpy.mockClear();
      process.env.LOG_LEVEL = prop;
      const { getLogLevel, LOG_LEVELS } = await import('./log');

      expect(getLogLevel()).toBe(LOG_LEVELS.info);
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0][0]).toContain(JSON.stringify(prop));
    }
  });

  test('emits warning at most once across repeated getLogLevel calls and log invocations', async () => {
    process.env.LOG_LEVEL = 'invalid_level';
    const { getLogLevel, logger } = await import('./log');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Multiple direct getLogLevel calls
    getLogLevel();
    getLogLevel();
    getLogLevel();

    // Multiple logger calls
    logger.info('Message 1');
    logger.warn('Message 2');
    logger.error('Message 3');

    expect(warnSpy).toHaveBeenCalledOnce();

    logSpy.mockRestore();
  });

  test('confirms filtering behaviour for valid values remains unchanged', async () => {
    process.env.LOG_LEVEL = 'warn';
    const { logger } = await import('./log');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // debug and info should be suppressed when level is warn
    logger.debug('should be filtered');
    logger.info('should be filtered');
    expect(logSpy).not.toHaveBeenCalled();

    // warn and error should be emitted
    logger.warn('should be emitted');
    expect(logSpy).toHaveBeenCalledOnce();

    logger.error('should be emitted');
    expect(logSpy).toHaveBeenCalledTimes(2);

    logSpy.mockRestore();
  });
});
