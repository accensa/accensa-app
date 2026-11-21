import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNBOOK = fs.readFileSync(path.join(ROOT, 'docs/RUNBOOK.md'), 'utf8');
const HEALTH_ROUTE = fs.readFileSync(
  path.join(ROOT, 'apps/web/src/app/api/health/route.ts'),
  'utf8',
);
const STALE_WORKFLOW = fs.readFileSync(
  path.join(ROOT, '.github/workflows/stale-check.yml'),
  'utf8',
);

function oneMatch(source, pattern, description) {
  const regex =
    pattern instanceof RegExp && !pattern.global
      ? new RegExp(pattern.source, `${pattern.flags}g`)
      : pattern;
  const matches = [...source.matchAll(regex)];
  assert.equal(matches.length, 1, `expected exactly one ${description}, found ${matches.length}`);
  return matches[0];
}

function routeFallback(constantName) {
  const match = oneMatch(
    HEALTH_ROUTE,
    new RegExp(`const ${constantName} = Number\\([^)]*\\?\\?\\s*([\\d_*\\s]+)\\)`),
    `${constantName} health-route fallback`,
  );
  return match[1]
    .split('*')
    .map((part) => Number(part.trim().replaceAll('_', '')))
    .reduce((product, value) => product * value, 1);
}

describe('runbook thresholds and health-check cadence', () => {
  test('documents the health route warning and critical ledger thresholds', () => {
    const warning = oneMatch(
      RUNBOOK,
      /SYNC_LAG_WARN_LEDGERS` \(([\d,]+)k\)/g,
      'warning threshold in the runbook',
    );
    const critical = oneMatch(
      RUNBOOK,
      /SYNC_LAG_CRITICAL_LEDGERS` \(([\d,]+)k\)/g,
      'critical threshold in the runbook',
    );
    const runbookWarning = Number(warning[1].replaceAll(',', '')) * 1000;
    const runbookCritical = Number(critical[1].replaceAll(',', '')) * 1000;

    assert.equal(
      runbookWarning,
      routeFallback('LAG_WARN'),
      `RUNBOOK warning threshold is ${runbookWarning}; health route fallback is ${routeFallback('LAG_WARN')}`,
    );
    assert.equal(
      runbookCritical,
      routeFallback('LAG_CRITICAL'),
      `RUNBOOK critical threshold is ${runbookCritical}; health route fallback is ${routeFallback('LAG_CRITICAL')}`,
    );
  });

  test('documents the stale-sync default from the health route', () => {
    const match = oneMatch(
      RUNBOOK,
      /SYNC_STALE_MS`, default (\d+)h/g,
      'stale-sync default in the runbook',
    );
    const runbookDefault = Number(match[1]) * 60 * 60 * 1000;
    const routeDefault = routeFallback('NO_SYNC_CRITICAL_MS');

    assert.equal(
      runbookDefault,
      routeDefault,
      `RUNBOOK stale-sync default is ${runbookDefault}ms; health route fallback is ${routeDefault}ms`,
    );
  });

  test('documents the stale-check workflow schedule', () => {
    const cron = oneMatch(
      STALE_WORKFLOW,
      /^\s+- cron:\s*['"]([^'"]+)['"]/gm,
      'stale-check cron expression',
    )[1].split(/\s+/);
    assert.equal(cron.length, 5, `expected a five-field cron expression, received ${cron.length}`);

    const interval = /^\*\/(\d+)$/.exec(cron[1]);
    assert.ok(interval, `expected an hour interval in the cron expression, received "${cron[1]}"`);
    const runbookSchedule = oneMatch(
      RUNBOOK,
      /at minute (\d+) every two hours/g,
      'stale-check schedule in the runbook',
    );

    assert.equal(
      Number(runbookSchedule[1]),
      Number(cron[0]),
      'runbook minute must match workflow cron',
    );
    assert.equal(Number(interval[1]), 2, 'workflow hour interval must remain two hours');
  });
});
