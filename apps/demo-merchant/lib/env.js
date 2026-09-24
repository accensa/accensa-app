import dotenv from 'dotenv';

/**
 * The environment contract behind `.env.example`, as code (#344, #340).
 *
 * Before this module, `server.js` read `process.env` inline in six places,
 * never loaded `.env` at all (only the buyer-side scripts did), and paid to
 * an un-replaceable placeholder address when `MERCHANT_ADDRESS` was unset —
 * three silent failures. Everything now flows through {@link loadEnv}: `.env`
 * is loaded, the whole contract is validated in one pass, every problem is
 * reported together, optional values fall back to documented defaults with a
 * log line, and an unusable setup throws {@link EnvError} instead of booting
 * a server that cannot settle a payment.
 */

/**
 * Native XLM's Stellar Asset Contract on testnet — the default price target.
 *
 * Priced as an explicit AssetAmount rather than a bare number: the default
 * money parser assumes USDC, and the asset has to match what the indexer
 * watches (ASSET_CONTRACT_IDS) or the settled transfer is never picked up.
 */
export const DEFAULT_XLM_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

/**
 * Raised when the environment cannot satisfy `.env.example`.
 *
 * Carries every problem at once, so a fresh setup is fixed in one edit
 * rather than one restart per missing variable.
 */
export class EnvError extends Error {
  constructor(problems) {
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
 * Loads `.env` into `process.env` without overriding anything already set —
 * the real environment always wins. A missing file is fine (running with
 * variables inline is a supported flow); an unreadable one is logged rather
 * than thrown, because `loadEnv` reports the contract as a whole anyway.
 */
export function loadDotEnv(log = console) {
  const result = dotenv.config({ quiet: true });
  const code = result.error?.code;
  if (result.error && code !== 'ENOENT') {
    log.warn(`⚠️  Could not read .env: ${result.error.message}`);
  }
}

/** Required and non-blank, or appended to `problems` with a hint. */
function requireVar(env, name, problems, hint) {
  const value = String(env[name] ?? '').trim();
  if (value === '') problems.push(`${name} is required — ${hint}`);
  return value;
}

/** Optional: falls back to `fallback` with one log line — never silently. */
function optionalVar(env, name, fallback, log) {
  const value = String(env[name] ?? '').trim();
  if (value !== '') return value;
  log.warn(`⚠️  ${name} is not set — using the default ${fallback}`);
  return fallback;
}

/** Optional secret: falls back to undefined (feature off), with one log line. */
function optionalSecret(env, name, disabledMeaning, log) {
  const value = String(env[name] ?? '').trim();
  if (value !== '') return value;
  log.warn(`⚠️  ${name} is not set — ${disabledMeaning}`);
  return undefined;
}

/** Ports are validated, not trusted: anything odd falls back to 3001, loudly. */
function readPort(raw, log) {
  const value = String(raw ?? '').trim();
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
 * Loads `.env`, validates the whole `.env.example` contract in one pass, and
 * returns the seller's configuration keyed by variable name.
 *
 * All problems are collected before throwing, so a misconfigured setup gets
 * the full list in a single message instead of one error per restart, and
 * every fallback is logged so nothing degrades silently (#344).
 *
 * @throws {EnvError} when a required variable is missing or blank.
 */
export function loadEnv(env = process.env, log = console) {
  loadDotEnv(log);

  const problems = [];
  const port = readPort(env.PORT, log);
  const accensaUrl = optionalVar(env, 'ACCENSA_URL', 'http://localhost:3000', log);
  const tokenAddress = optionalVar(env, 'TOKEN_ADDRESS', DEFAULT_XLM_SAC, log);
  const hookApiKey = optionalSecret(env, 'HOOK_API_KEY', 'attribution reporting stays off', log);
  const webhookSecret = optionalSecret(env, 'WEBHOOK_SECRET', 'signatures go unchecked', log);
  const merchantAddress = requireVar(env, 'MERCHANT_ADDRESS', problems, 'receives the paid XLM');

  if (problems.length > 0) throw new EnvError(problems);

  return {
    PORT: port,
    ACCENSA_URL: accensaUrl,
    TOKEN_ADDRESS: tokenAddress,
    HOOK_API_KEY: hookApiKey,
    WEBHOOK_SECRET: webhookSecret,
    MERCHANT_ADDRESS: merchantAddress,
  };
}
