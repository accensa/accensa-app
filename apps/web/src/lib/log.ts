/**
 * Structured logger with environment-variable-based log level filtering
 * and sensitive data redaction.
 *
 * Environment variable:
 * - LOG_LEVEL: The minimum log level to emit.
 *   Accepted values: 'debug', 'info', 'warn', 'error' (case-insensitive).
 *   Default: 'info'.
 *   An empty string or unset variable defaults to 'info' without a warning.
 *   Unrecognised values trigger a one-time console.warn warning and default to 'info'.
 */

const SENSITIVE_KEYS = new Set([
  'database_url',
  'cron_secret',
  'merchant_public_key',
  'webhook_url',
  'x-signature',
]);

export const LOG_LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const);

export type LogLevel = keyof typeof LOG_LEVELS;

export const ACCEPTED_LOG_LEVELS: readonly LogLevel[] = Object.freeze(
  Object.keys(LOG_LEVELS) as LogLevel[],
);

let hasWarnedInvalidLogLevel = false;

export function getLogLevel(): number {
  const raw = process.env.LOG_LEVEL;
  if (raw === undefined || raw === '') {
    return LOG_LEVELS.info;
  }

  const level = raw.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LOG_LEVELS, level)) {
    return LOG_LEVELS[level as LogLevel];
  }

  if (!hasWarnedInvalidLogLevel) {
    hasWarnedInvalidLogLevel = true;
    console.warn(
      `Unrecognised LOG_LEVEL ${JSON.stringify(raw)}; accepted levels are ${ACCEPTED_LOG_LEVELS.join(', ')}; defaulting to info`,
    );
  }

  return LOG_LEVELS.info;
}

export function redact(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    // Also redact string values if they look like known sensitive environment variables
    const secrets = [
      process.env.DATABASE_URL,
      process.env.CRON_SECRET,
      process.env.MERCHANT_PUBLIC_KEY,
    ].filter(Boolean) as string[];

    let redactedString = obj;
    for (const secret of secrets) {
      if (secret && redactedString.includes(secret)) {
        redactedString = redactedString.replaceAll(secret, '[REDACTED]');
      }
    }
    return redactedString;
  }

  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(redact);
  }

  const redactedObj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      redactedObj[key] = '[REDACTED]';
    } else {
      redactedObj[key] =
        typeof value === 'object' || typeof value === 'string' ? redact(value) : value;
    }
  }
  return redactedObj;
}

function logMessage(level: string, message: string, meta?: Record<string, unknown>) {
  if (LOG_LEVELS[level as LogLevel] < getLogLevel()) return;

  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...((redact(meta || {}) as object) || {}),
  };

  console.log(JSON.stringify(entry));
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => logMessage('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => logMessage('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => logMessage('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => logMessage('error', message, meta),
};
