/**
 * The environment contract behind `.env.example` (#344, #340).
 *
 * What this replaces: `tsx --env-file=.env` crashed before any of the
 * example's code ran when `.env` was absent, and a missing variable threw an
 * unhandled `Error` from module scope with only a stack trace. Everything now
 * funnels through `loadEnv()`: `.env` is read here (a missing file is not
 * fatal), all problems are collected and reported together, optional values
 * fall back to documented defaults with a log line, and the caller owns the
 * exit — see `loadEnvOrExit` in `index.ts`.
 */
import { readFileSync } from 'node:fs';

/** Anything the config layer can warn through — `console` satisfies it. */
interface Warnable {
  warn: (message: string) => void;
}

/** The typed configuration the example runs on. */
export interface ExampleEnv {
  port: number;
  indexerUrl: string;
  privateKeyHex: string;
  merchantAddress: string;
  tokenAddress: string;
  adminToken: string | null;
}

/** Every way the environment can fail to satisfy `.env.example`. */
export class EnvError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    const bullets = problems.map((problem) => `  - ${problem}`).join('\n');
    const message =
      `Environment is missing required values:\n${bullets}\n` +
      'Copy .env.example to .env in this directory and fill it in.';
    super(message);
    this.name = 'EnvError';
    this.problems = problems;
  }
}

/**
 * Minimal `.env` reader: `KEY=value` lines, `#` comments, optional quotes.
 *
 * Lines that are neither — blank lines, comments, or prose such as this
 * template's header — are skipped rather than treated as an error.
 */
export function parseDotEnv(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (key === '') continue;
    let value = trimmed.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    parsed[key] = value;
  }
  return parsed;
}

/**
 * Reads `.env` into `process.env` without overriding anything already set —
 * the real environment always wins. A missing file is silent: running with
 * variables provided inline is a supported flow, and `loadEnv`'s report says
 * what is actually missing either way. An unreadable file is logged.
 */
export function loadDotEnv(log: Warnable = console): void {
  let contents: string;
  try {
    contents = readFileSync('.env', 'utf8');
  } catch (cause) {
    const code = (cause as { code?: string }).code;
    if (code !== 'ENOENT') {
      const detail = cause instanceof Error ? cause.message : String(cause);
      log.warn(`⚠️  Could not read .env: ${detail}`);
    }
    return;
  }
  for (const [key, value] of Object.entries(parseDotEnv(contents))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Ports are validated, not trusted: anything odd falls back to 3001, loudly. */
function readPort(raw: string | undefined, log: Warnable): number {
  const value = (raw ?? '').trim();
  if (value === '') {
    log.warn('⚠️  PORT is not set — using the default 3001');
    return 3001;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    log.warn(`⚠️  PORT=${value} is not a valid port — using the default 3001`);
    return 3001;
  }
  return port;
}

/**
 * Native XLM's Stellar Asset Contract on testnet — the default price target.
 *
 * The asset must match what the Accensa indexer watches, or the settled
 * transfer is never picked up.
 */
const DEFAULT_TOKEN_ADDRESS = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

/**
 * Loads `.env` (if present), validates the whole contract in one pass, and
 * returns the typed configuration the example runs on.
 *
 * Every missing required variable is reported together, and each optional
 * fallback is logged so nothing degrades silently.
 *
 * @throws {EnvError} listing every problem at once.
 */
export function loadEnv(
  env: Record<string, string | undefined> = process.env,
  log: Warnable = console,
): ExampleEnv {
  loadDotEnv(log);

  const problems: string[] = [];
  const privateKeyHex = (env.ACCENSA_PRIVATE_KEY_HEX ?? '').trim();
  if (privateKeyHex === '') {
    problems.push('ACCENSA_PRIVATE_KEY_HEX is required — it signs every settlement report');
  }
  const merchantAddress = (env.MERCHANT_ADDRESS ?? '').trim();
  if (merchantAddress === '') {
    problems.push('MERCHANT_ADDRESS is required — the Stellar address that receives payment');
  }
  const adminToken = (env.ADMIN_TOKEN ?? '').trim();
  if (adminToken === '') {
    log.warn('⚠️  ADMIN_TOKEN is not set — /admin/stats will reject every request');
  }

  const config: ExampleEnv = {
    port: readPort(env.PORT, log),
    indexerUrl: (env.ACCENSA_URL ?? '').trim() || 'http://localhost:3000',
    tokenAddress: (env.TOKEN_ADDRESS ?? '').trim() || DEFAULT_TOKEN_ADDRESS,
    adminToken: adminToken || null,
    privateKeyHex,
    merchantAddress,
  };

  if (problems.length > 0) throw new EnvError(problems);
  return config;
}
