/**
 * Validate the gitignore subset used by `.prettierignore`: blank/comment
 * lines, root-relative paths, directory suffixes, basename patterns, and `*`.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IGNORE_PATH = path.join(ROOT, '.prettierignore');
const GENERATED_PATHS = [
  '.merkle-vectors.json',
  'packages/sdk/merkle-vectors.json',
  '.kilo/worktrees/fixture/file',
  '.claude/worktrees/fixture/file',
  'apps/web/test-results/fixture.json',
  'node_modules/fixture/index.js',
  'apps/web/.next/server/fixture.js',
  'apps/web/build/fixture.js',
  'packages/sdk/dist/fixture.js',
  'apps/docs/.docusaurus/fixture.js',
  'apps/web/chunk.min.js',
  'apps/web/next-env.d.ts',
];
let cachedTrackedFiles;

function readIgnoreEntries() {
  return fs
    .readFileSync(IGNORE_PATH, 'utf8')
    .split(/\r?\n/)
    .map((text, index) => ({ line: index + 1, pattern: text.trim() }))
    .filter(({ pattern }) => pattern !== '' && !pattern.startsWith('#'));
}

function globToRegExp(pattern) {
  return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`);
}

function matches(entry, filePath) {
  const pattern = entry.pattern;
  const rootAnchored = pattern.startsWith('/');
  const directory = pattern.endsWith('/');
  const cleanPattern = pattern.replace(/^\/|\/$/g, '');
  const cleanPath = filePath.replace(/^\/+/, '');

  if (rootAnchored) {
    return cleanPath === cleanPattern || (directory && cleanPath.startsWith(`${cleanPattern}/`));
  }

  if (!cleanPattern.includes('/')) {
    const matcher = globToRegExp(cleanPattern);
    return cleanPath.split('/').some((part) => matcher.test(part));
  }

  if (cleanPattern.includes('/')) {
    return cleanPath === cleanPattern || (directory && cleanPath.startsWith(`${cleanPattern}/`));
  }

  return false;
}

function trackedFiles() {
  cachedTrackedFiles ??= execFileSync('git', ['ls-files', '--cached', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  return cachedTrackedFiles;
}

function matchesInOrder(entries, candidates) {
  return entries.map((entry, index) => {
    const paths = candidates.filter((candidate) => matches(entry, candidate));
    const previousEntries = entries.slice(0, index);
    const allPathsShadowed =
      paths.length > 0 &&
      paths.every((candidate) => previousEntries.some((previous) => matches(previous, candidate)));
    const shadowingEntries = allPathsShadowed
      ? previousEntries.filter((previous) => paths.some((candidate) => matches(previous, candidate)))
      : [];
    return { entry, paths, shadowingEntries };
  });
}

describe('.prettierignore entries', () => {
  test('each entry matches a tracked, present, or explicitly generated path without shadowing earlier rules', () => {
    const entries = readIgnoreEntries();
    const tracked = trackedFiles();
    const candidates = [...new Set([...tracked, ...GENERATED_PATHS])];

    for (const { entry, paths, shadowingEntries } of matchesInOrder(entries, candidates)) {
      assert.ok(paths.length > 0, `line ${entry.line} (${entry.pattern}) matches no known path`);
      assert.deepEqual(
        shadowingEntries,
        [],
        `line ${entry.line} (${entry.pattern}) is shadowed by ${shadowingEntries
          .map(({ line, pattern }) => `line ${line} (${pattern})`)
          .join(', ')}`,
      );
    }

    for (const { line, pattern } of entries) {
      if (pattern.includes('*')) continue;
      const target = pattern.replace(/^\/|\/$/g, '');
      const exists = tracked.includes(target) || fs.existsSync(path.join(ROOT, target));
      const generatedTarget = GENERATED_PATHS.some(
        (candidate) => candidate === target || candidate.startsWith(`${target}/`),
      );
      assert.ok(
        exists || generatedTarget,
        `line ${line} (${pattern}) names neither a tracked/present path nor a documented generated path`,
      );
    }
  });

  test('generated directories and the two merkle-vector files remain covered precisely', () => {
    const entries = readIgnoreEntries();
    const candidates = [...new Set([...trackedFiles(), ...GENERATED_PATHS])];
    const coverage = matchesInOrder(entries, candidates);

    for (const directory of ['.kilo/worktrees/', '.claude/worktrees/', 'apps/web/test-results/']) {
      const entry = entries.find(({ pattern }) => pattern === directory);
      assert.ok(
        entry,
        `generated directory ignore entry must retain its trailing slash: ${directory}`,
      );
      assert.ok(
        matches(entry, `${directory}fixture/file`),
        `${directory} must cover generated files`,
      );
    }

    for (const file of ['.merkle-vectors.json', 'packages/sdk/merkle-vectors.json']) {
      assert.ok(
        coverage.some(
          ({ entry, paths }) =>
            entry.pattern === (file.startsWith('.') ? `/${file}` : file) && paths.includes(file),
        ),
        `${file} must have its own non-shadowed ignore entry`,
      );
    }

    for (const generated of [
      'node_modules/fixture/index.js',
      'apps/web/.next/server/fixture.js',
      'apps/web/build/fixture.js',
      'packages/sdk/dist/fixture.js',
      'apps/docs/.docusaurus/fixture.js',
    ]) {
      assert.ok(
        entries.some((entry) => matches(entry, generated)),
        `${generated} must remain covered as a generated output`,
      );
    }
  });
});
