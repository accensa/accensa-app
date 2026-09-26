import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DotenvError, DotenvLoadError, DotenvParseError } from './errors.js';

// @ts-expect-error - import.meta is allowed in ESM context; TS1470 is a false positive due to tsup CJS build
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Template for `packages/sdk/examples/express-server/.env.example`.
 *
 * The template is a strict subset of the variables the example server reads.
 * The loader below parses this exact file, so any new key added to the
 * example must be added here too — otherwise the tests below fail, which is
 * the point: the test suite pins the template's shape and we can't drift a
 * .env.example into the SDK without noticing.
 */
const TEMPLATE_PATH = join(__dirname, '..', 'examples', 'express-server', '.env.example');

/** Default value applied when the key is marked `(no default)` with no `=` in the template. */
function defaultFor(line: string): string | null {
  const match = line.match(
    /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(?:'([^']*)'|"([^"]*)")\s*(?:#.*)?$/,
  );
  if (!match) return null;
  return match[2] !== undefined ? match[2] : (match[3] ?? null);
}

/**
 * Convert `key=value` template lines into the env variables the example load
 * script expects. The template header lines (`# Ed25519 private key...`) are
 * ignored, so this is a strict parsing of the `KEY=` rows.
 */
export function templateKeys(): string[] {
  const content = readFileSync(TEMPLATE_PATH, 'utf8');
  const keys: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('[')) continue;
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/);
    if (match) keys.push(match[1]);
  }
  return keys;
}

/**
 * Parse the `.env.example` template and return `{ keys, defaults }` so consumers
 * can assert the template is complete and generate a valid `.env` skeleton.
 *
 * Both `keys` and `defaults` are ordered to match the file, not a `Set`, so a
 * template reorder is a test failure, not a silent reorder.
 */
export interface TemplateConfig {
  keys: string[];
  defaults: Record<string, string>;
}

/** Value in the template (unquoted, if any) that should be used when generating the real `.env`. */
export function parseTemplate(): TemplateConfig {
  const content = readFileSync(TEMPLATE_PATH, 'utf8');
  const keys: string[] = [];
  const defaults: Record<string, string> = {};

  let offendingLine = 0;
  const errors: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    offendingLine += 1;
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('[')) continue;

    // `KEY=value` rows; skip header and section markers (the `# Ed25519...`
    // comments and the `ACCENSA_PRIVATE_KEY_HEX=` default rows).
    const match = line.match(
      /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(?:'([^']*)'|"([^"]*)"|([^\s#]*)|\$\{\s*([A-Z0-9_]+\s*)?\})\s*(?:#.*)?$/,
    );
    if (!match) {
      errors.push(`${offendingLine}:1: expected "KEY=value", got "${line}"`);
      continue;
    }

    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? match[5] ?? '';
    keys.push(key);
    defaults[key] = value;
  }

  if (errors.length > 0) {
    throw new DotenvParseError(errors.join('\n'), TEMPLATE_PATH, offendingLine);
  }

  return { keys, defaults };
}

/** Load `.env` next to the current file, applying the template's default values for missing keys. */
export function loadEnvironment(): Readonly<Record<string, string>> {
  // @ts-expect-error - import.meta is allowed in ESM context; TS1470 is a false positive due to tsup CJS build
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = join(here, '..', '..', '.env');

  const variables = new Map<string, string>();

  // Load an existing `.env` next to the runtime module, if present, so tests
  // can override individual values without editing the template.
  if (existsSync(envPath)) {
    const parsed = parseDotenvFile(envPath);
    for (const [key, value] of parsed) variables.set(key, value);
  }

  // Apply the template's documented defaults for every key the example
  // documents. This keeps `pnpm dev` working on a clean checkout and pins the
  // template as the source of truth for the example's required keys.
  const { keys, defaults } = parseTemplate();
  for (const key of keys) {
    if (!variables.has(key) && Object.prototype.hasOwnProperty.call(defaults, key)) {
      variables.set(key, defaults[key]);
    }
  }

  // Make the values read-only to catch typos in consuming code.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = {};
  for (const [key, value] of variables) {
    Object.defineProperty(result, key, {
      value,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
  return result as Readonly<Record<string, string>>;
}

/**
 * Parse a `.env` file the same way the template is parsed.
 *
 * Only `KEY=value` rows are accepted. Blank lines, `#` comments and section
 * markers (`[section]`) are ignored, and `export KEY=value` rows are accepted.
 * A line that does not match is a structured parse error, not a silent skip:
 * the example template is machine-generated, so typos surface here at boot
 * instead of as "undefined is required" deep in the request path.
 */
export function parseDotenvFile(filePath: string): Map<string, string> {
  if (!existsSync(filePath)) {
    throw new DotenvLoadError(`Environment file not found: ${filePath}`, filePath, null);
  }

  const variables = new Map<string, string>();
  let offendingLine = 0;

  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    offendingLine += 1;
    const line = rawLine.trim();

    // Skip blank lines, full-line comments and section markers. A section
    // header in a `.env` file would otherwise be silently ignored and leave
    // the environment half-configured.
    if (!line || line.startsWith('#') || line.startsWith('[')) continue;

    // Explicit `export` prefix is accepted for the same file a developer might
    // source in a shell. The variable name is still validated below.
    const cleaned = line.startsWith('export ') ? line.slice('export '.length).trimStart() : line;

    const match = cleaned.match(
      /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:'([^']*)'|"([^"]*)"|([^\s#]*))(?:#.*)?$/,
    );
    if (!match) {
      throw new DotenvParseError(
        `Invalid environment variable definition on line ${offendingLine}: "${cleaned}"`,
        filePath,
        offendingLine,
      );
    }

    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    variables.set(key, value);
  }

  return variables;
}
