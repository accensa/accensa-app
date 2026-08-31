const SENSITIVE_KEYS = new Set([
  'database_url',
  'cron_secret',
  'merchant_public_key',
  'webhook_url',
  'x-signature',
]);

const LOG_LEVELS: Record<string, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function getLogLevel(): number {
  const level = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LOG_LEVELS[level] || LOG_LEVELS.info;
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
  if (LOG_LEVELS[level] < getLogLevel()) return;

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
