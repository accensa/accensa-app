import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The e2e README is the instruction sheet a contributor follows before
// regenerating snapshots (`pnpm --filter web test:visual:update`). It has to
// name the same baselines the specs capture, or the person reviewing a
// screenshot diff is told to expect a set that does not exist while three
// unfamiliar images change silently. This guard keeps the two in step.

const e2eDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'e2e');
const readmePath = join(e2eDir, 'README.md');

function specFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '__screenshots__') return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return specFiles(full);
    return entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

// Every name a spec passes to toHaveScreenshot(), across every spec file, so a
// second spec needs no change here.
function capturedNames() {
  const names = new Set();
  for (const file of specFiles(e2eDir)) {
    const source = readFileSync(file, 'utf8');
    const pattern = /toHaveScreenshot\(\s*['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(pattern)) names.add(match[1]);
  }
  return names;
}

// Only the visual-regression section counts: a command elsewhere in the file
// (a future `--update-snapshots` example, say) is not a baseline, and scanning
// the whole document would turn one into a false failure.
function documentedNames() {
  const lines = readFileSync(readmePath, 'utf8').split('\n');
  const start = lines.findIndex((line) => /^#\s+Visual regression\s*$/.test(line.trim()));
  assert.notEqual(
    start,
    -1,
    'apps/web/e2e/README.md must keep a "# Visual regression" section for this guard to read',
  );

  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    section.push(line);
  }

  const names = new Set();
  for (const line of section) {
    // Backticked names in the list, with or without a `__screenshots__/`
    // prefix. Prose may mention a file, but only a backticked one is a claim
    // about the list, and that is what this guard enforces.
    for (const match of line.matchAll(/`(?:[^`/]*\/)*([^`/]+\.png)`/g)) names.add(match[1]);
  }
  return names;
}

function describe(names) {
  return [...names].sort().join(', ') || '(none)';
}

test('e2e README lists exactly the screenshots the visual specs capture', () => {
  const captured = capturedNames();
  const documented = documentedNames();

  assert.ok(
    captured.size > 0,
    'no toHaveScreenshot() call was found under apps/web/e2e; the visual suite is the subject of this guard',
  );

  const missing = [...captured].filter((name) => !documented.has(name)).sort();
  const stale = [...documented].filter((name) => !captured.has(name)).sort();

  assert.deepEqual(
    missing,
    [],
    `apps/web/e2e/README.md does not list ${describe(missing)}, which ${captured.size === missing.length ? 'the visual specs' : 'at least one visual spec'} captures. A contributor reading the README would not know to expect ${missing.length === 1 ? 'that screenshot' : 'those screenshots'} to change.`,
  );
  assert.deepEqual(
    stale,
    [],
    `apps/web/e2e/README.md lists ${describe(stale)}, which no toHaveScreenshot() call captures. A bullet describing a test that does not exist is worse than no bullet: it sends the reader looking for a snapshot that was never written.`,
  );
});
