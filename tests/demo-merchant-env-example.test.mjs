import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');
const ENV_JS_PATH = join(REPO_ROOT, 'apps', 'demo-merchant', 'lib', 'env.js');
const ENV_EXAMPLE_PATH = join(REPO_ROOT, 'apps', 'demo-merchant', '.env.example');

/**
 * Extracts literal variable names passed to env readers in env.js.
 * Matches: readEnv, requireEnv, optionalEnv, parsePort, parseBaseUrl,
 * parseRouteList, requireStellarAddress.
 */
export function extractEnvVarNames(envSource) {
  const pattern =
    /(?:readEnv|requireEnv|optionalEnv|parsePort|parseBaseUrl|parseRouteList|requireStellarAddress)\s*\(\s*['"]([^'"]+)['"]/g;
  const names = new Set();
  let match;
  while ((match = pattern.exec(envSource)) !== null) {
    names.add(match[1]);
  }
  return [...names].sort();
}

/**
 * Extracts environment variable names from .env.example.
 * Matches NAME= lines, ignoring comments (#) and blank lines.
 */
export function extractExampleEnvVars(exampleSource) {
  const names = new Set();
  const lines = exampleSource.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)=/);
    if (match) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

test('assert every env var the demo merchant reads is documented in .env.example (#770)', () => {
  const envSource = readFileSync(ENV_JS_PATH, 'utf-8');
  const exampleSource = readFileSync(ENV_EXAMPLE_PATH, 'utf-8');

  const readVars = extractEnvVarNames(envSource);
  const exampleVars = extractExampleEnvVars(exampleSource);

  assert.ok(readVars.length > 0, 'env.js must read at least one environment variable');
  assert.ok(exampleVars.length > 0, '.env.example must define at least one variable');

  // Check direction 1: every variable read in env.js appears in .env.example
  const missingFromExample = readVars.filter((v) => !exampleVars.includes(v));
  assert.deepEqual(
    missingFromExample,
    [],
    `Environment variables read in env.js but missing from .env.example: ${missingFromExample.join(', ')}`,
  );

  // Check direction 2: every variable in .env.example is read in env.js (no dead keys)
  const deadInExample = exampleVars.filter((v) => !readVars.includes(v));
  assert.deepEqual(
    deadInExample,
    [],
    `Environment variables in .env.example that are no longer read in env.js: ${deadInExample.join(', ')}`,
  );
});

