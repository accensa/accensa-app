/**
 * Guard: every workflow job declares `timeout-minutes` (#788).
 *
 * ## Why this exists
 *
 * GitHub Actions applies a 360-minute default when a job does not set a cap.
 * That default is far longer than any of these jobs take, so a wedged runner,
 * a step waiting on an interactive prompt or a request that never returns burns
 * runner minutes for up to six hours before anything fails. The jobs that can
 * hang are exactly the ones that call an external service: the curl in
 * `stale-check.yml` is capped per *request* (`--max-time 30`), not per job, and
 * `sync.yml` deliberately holds a runner alive for 55 minutes, so a stuck
 * iteration there looks like normal operation for a very long time.
 *
 * Six of eleven jobs already set the field, so this is a half-applied
 * convention rather than a new one; a convention that only lives in review
 * comments drifts back, which is why it is a test.
 *
 * ## Parser
 *
 * No YAML dependency. The workflow files are a small, fixed subset of YAML, so
 * the block structure is read by indentation:
 *
 *  - a top-level `jobs:` line opens the block;
 *  - a key indented exactly two spaces is a job id, and its body runs until the
 *    next two-space key;
 *  - inside a job's body, `timeout-minutes` is a key indented four spaces.
 *
 * Reading only after `jobs:` is what keeps the `on:`, `concurrency:` and
 * `permissions:` blocks — which also contain two-space keys — out of the result.
 *
 * Run from the repository root: `pnpm test` (→ `node --test tests/*.test.mjs`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');

/** Every workflow file, in a stable order so failure output is reproducible. */
function workflowFiles() {
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort();
}

/**
 * Split workflow source into jobs.
 *
 * Returns `{ id, line, timeout }` per job, where `line` is the 1-based line of
 * the job key and `timeout` is the raw value of `timeout-minutes` (or `null`
 * when the job does not declare one).
 */
export function parseJobs(source) {
  /** @type {{ id: string, line: number, timeout: string | null }[]} */
  const jobs = [];
  let inJobs = false;
  /** @type {{ id: string, line: number, timeout: string | null } | null} */
  let current = null;

  source.split(/\r?\n/).forEach((line, index) => {
    if (/^jobs:\s*(#.*)?$/.test(line)) {
      inJobs = true;
      current = null;
      return;
    }

    if (!inJobs) return;

    // Any other top-level key (a column-0 non-comment) closes the block.
    if (/^\S/.test(line) && !line.startsWith('#')) {
      inJobs = false;
      current = null;
      return;
    }

    const jobKey = /^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(line);
    if (jobKey) {
      current = { id: jobKey[1], line: index + 1, timeout: null };
      jobs.push(current);
      return;
    }

    if (!current) return;

    const timeout = /^ {4}timeout-minutes:\s*(\S+)/.exec(line);
    if (timeout) current.timeout = timeout[1];
  });

  return jobs;
}

function jobsOf(file) {
  return parseJobs(fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8'));
}

test('every job in .github/workflows/ declares timeout-minutes', () => {
  const missing = workflowFiles().flatMap((file) =>
    jobsOf(file)
      .filter((job) => job.timeout === null)
      .map((job) => `${file}:${job.line} job "${job.id}"`),
  );

  assert.deepEqual(
    missing,
    [],
    `Jobs without a timeout-minutes cap (GitHub would allow each 360 minutes):\n` +
      missing.map((entry) => `  - ${entry}`).join('\n') +
      `\n\nAdd \`timeout-minutes:\` to the job body, sized from that job's observed ` +
      `runtime rather than copied from a neighbour.`,
  );
});

test('every declared timeout-minutes is a positive whole number of minutes', () => {
  const invalid = workflowFiles().flatMap((file) =>
    jobsOf(file)
      .filter((job) => job.timeout !== null && !/^\d+$/.test(job.timeout))
      .map((job) => `${file}:${job.line} job "${job.id}" has timeout-minutes: ${job.timeout}`),
  );

  assert.deepEqual(invalid, [], `Invalid timeout-minutes values:\n  - ${invalid.join('\n  - ')}`);
});

test('sync.yml is capped above the loop budget that keeps its runner alive', () => {
  const source = fs.readFileSync(path.join(WORKFLOW_DIR, 'sync.yml'), 'utf8');

  // The loop holds the runner for `END_TIME` seconds (3300 = 55 minutes) so a
  // 5-minute sync interval survives on a runner that drops frequent cron
  // triggers. A cap at or below that would kill a healthy run mid-loop, which
  // is a worse outcome than the drift this guard exists to prevent.
  const budget = /END_TIME=.*\+\s*(\d+)\s*\)\s*\)/.exec(source);
  assert.ok(
    budget,
    'sync.yml no longer declares END_TIME; update this guard with the new loop shape',
  );

  const budgetMinutes = Number(budget[1]) / 60;
  const sync = parseJobs(source).find((job) => job.id === 'sync');
  assert.ok(sync, 'sync.yml no longer declares a `sync` job');

  assert.ok(
    Number(sync.timeout) > budgetMinutes,
    `sync.yml timeout-minutes is ${sync.timeout}, but the job's own loop runs for ` +
      `${budgetMinutes} minutes. The cap must exceed the loop budget.`,
  );
});

test('the parser reads job keys and ignores on:, concurrency: and permissions:', () => {
  const sample = [
    'name: sample',
    'on:',
    '  push:',
    '    branches: [main]',
    'concurrency:',
    '  group: sample',
    '  cancel-in-progress: true',
    'permissions:',
    '  contents: read',
    'jobs:',
    '  bounded:',
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 10',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '  unbounded:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo "hi"',
    '',
  ].join('\n');

  assert.deepEqual(parseJobs(sample), [
    { id: 'bounded', line: 11, timeout: '10' },
    { id: 'unbounded', line: 16, timeout: null },
  ]);
});
