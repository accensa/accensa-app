/**
 * Modular environment access for the demo merchant (issues #340 and #344).
 *
 * Before this module, each entrypoint read `process.env` inline with its own
 * mix of silent fallbacks and one-off checks — MERCHANT_ADDRESS quietly
 * became 'GAQW...REPLACE_WITH_REAL_ADDRESS' (a broken payment requirement
 * nobody notices until an agent fails to pay), and a typo in PORT produced a
 * `NaN` port instead of an error.
 *
 * Now every variable the examples read is defined in exactly one place with a
 * predictable failure mode:
 *   - required values throw `EnvError` at boot, naming the variable and
 *     pointing at `.env.example`;
 *   - optional values fall back, and the fallback is *logged* once at startup,
 *     never silently swallowed;
 *   - malformed values throw — a configured-but-invalid variable is an
 *     operator mistake, not something to guess around.
 */

const DEFAULT_MERCHANT_PORT = 3001;
const DEFAULT_ACCENSA_URL = 'http://localhost:3000';
const DEFAULT_AGENT_ROUTES = '/api/hello,/api/insights/daily';

/** Native XLM's Stellar Asset Contract on testnet. */
const DEFAULT_XLM_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

/**
 * A configuration failure. The message always names the offending variable,
 * shows what was found, and says where to fix it — the caller decides whether
 * to exit or keep serving, but it never has to guess what went wrong.
 */
export class EnvError extends Error {
  constructor(variable, message) {
    super(`${variable}: ${message} (see .env.example)`);
    this.name = 'EnvError';
    this.variable = variable;
  }
}

/** Trimmed value or undefined; an all-whitespace variable is "not set". */
export function readEnv(name) {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Required value; throws `EnvError` naming the variable when absent. */
export function requireEnv(name, hint) {
  const value = readEnv(name);
  if (value === undefined) {
    throw new EnvError(name, hint ?? 'is required — set it in your .env file');
  }
  return value;
}

/** Optional value with a documented fallback; the fallback is logged. */
export function optionalEnv(name, fallback, { log = true } = {}) {
  const value = readEnv(name);
  if (value === undefined && log) {
    console.warn(`⚠️  ${name} is not set; falling back to "${fallback}" (.env.example)`);
  }
  return value ?? fallback;
}

/**
 * Port: unset means the default, set-but-not-a-usable-port is an error.
 * The old `Number(process.env.PORT ?? 3001)` produced `NaN` and let the
 * listener fail somewhere inside node instead of here.
 */
export function parsePort(name, fallback = DEFAULT_MERCHANT_PORT) {
  const value = readEnv(name);
  if (value === undefined) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new EnvError(name, `"${value}" is not a valid port (integer 1-65535)`);
  }
  return port;
}

/** Absolute http(s) base URL, normalised without a trailing slash. */
export function parseBaseUrl(name, fallback) {
  const value = readEnv(name);
  if (value === undefined) return fallback;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new EnvError(name, `"${value}" is not an absolute URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new EnvError(name, `"${value}" must be an http(s) URL`);
  }
  return value.replace(/\/$/, '');
}

/** Comma-separated route list; blank entries are dropped, not guessed at. */
export function parseRouteList(name, fallback = DEFAULT_AGENT_ROUTES) {
  const value = readEnv(name);
  if (value === undefined) return fallback.split(',').map((route) => route.trim());
  const routes = value
    .split(',')
    .map((route) => route.trim())
    .filter(Boolean);
  if (routes.length === 0) {
    throw new EnvError(name, `"${value}" contains no usable routes`);
  }
  return routes;
}

/**
 * A Stellar account address to receive payments. Unlike the placeholder this
 * replaces, a missing or malformed address now fails at boot — an invalid
 * `payTo` silently converts every successful payment into a lost transfer.
 */
export function requireStellarAddress(name) {
  const value = requireEnv(
    name,
    'is required — the demo needs a funded testnet account to receive payments',
  );
  if (!/^G[A-Z2-7]{55}$/.test(value)) {
    throw new EnvError(name, `"${value}" does not look like a Stellar account address (G…)`);
  }
  return value;
}

/** Formats an EnvError for the console; deliberately excludes secret values. */
export function reportEnvError(error) {
  const message = error instanceof EnvError ? error.message : `env check failed: ${error.message}`;
  console.error(`❌ ${message}`);
  process.exit(1);
}

/**
 * Runs a loader, converting any EnvError into a friendly boot-time abort.
 * `process.exit(1)` inside reportEnvError means the catch below never
 * continues, but the `undefined` return keeps ESLint's consistent-return calm.
 */
export function boot(loader) {
  try {
    return loader();
  } catch (error) {
    reportEnvError(error);
    return undefined;
  }
}

/**
 * Everything `server.js` needs, validated once at boot. Optional variables
 * announce their fallback here so the startup log is the whole story.
 */
export function loadServerEnv() {
  const hookApiKey = readEnv('HOOK_API_KEY');
  if (hookApiKey === undefined) {
    console.warn('⚠️  HOOK_API_KEY is not set; settlement attribution reports will be skipped.');
  }
  const webhookSecret = readEnv('WEBHOOK_SECRET');
  console.log(
    webhookSecret === undefined
      ? '⚠️  WEBHOOK_SECRET is not set; inbound webhook signature checks run in permissive dev mode.'
      : '✅ Inbound webhook signature verification is enforced.',
  );
  return {
    port: parsePort('PORT', DEFAULT_MERCHANT_PORT),
    accensaUrl: parseBaseUrl('ACCENSA_URL', DEFAULT_ACCENSA_URL),
    hookApiKey,
    webhookSecret,
    tokenAddress: optionalEnv('TOKEN_ADDRESS', DEFAULT_XLM_SAC),
    payTo: requireStellarAddress('MERCHANT_ADDRESS'),
  };
}

/** Everything `agent.js` and `drive.js` need, validated once at boot. */
export function loadPayerEnv() {
  return {
    privateKey: requireEnv(
      'STELLAR_PRIVATE_KEY',
      'is required — fund a testnet payer first, see README.md',
    ),
    merchantUrl: parseBaseUrl('MERCHANT_URL', 'http://localhost:3001'),
    routes: parseRouteList('ROUTES'),
    // Left unset on purpose: lib/x402-payer.js supplies the testnet default,
    // and overriding that decision from here would be a second place to keep.
    rpcUrl: readEnv('STELLAR_RPC_URL'),
  };
}
