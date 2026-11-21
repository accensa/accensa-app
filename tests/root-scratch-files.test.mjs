/**
 * Guard: no one-off agent script is tracked at the repository root (#789).
 *
 * ## Why this exists
 *
 * `.gitignore:23-39` and `CONTRIBUTING.md:14-22` say the same thing: tooling
 * residue — PR bodies, issue dumps, one-off patch/fix scripts — belongs under
 * `.scratch/`, which is ignored. The ignore rules for `patch_*.js` and
 * `fix_*.js` landed *after* nine such files were already committed, so the
 * ignore never applied to them: `git ls-files` kept listing all nine, every
 * clone paid for them, and `prettier --check .` kept formatting them.
 *
 * A note in a document cannot fail a build, so the cleanup needs a guard that
 * can. This suite is that guard.
 *
 * ## What it checks
 *
 *  1. `git ls-files -z` contains no root-level entry matching `patch_*.js` or
 *     `fix_*.js`. The list is read from the index, not from the working tree,
 *     so an *untracked* `patch_x.js` in the root is deliberately fine — the
 *     rule is about what is committed, and it is `git add` that trips it.
 *
 *  2. The matcher itself: root entries only, `.js` only. `scripts/fix_x.js` and
 *     `packages/sdk/patch_x.js` are ordinary code, `.scratch/fix_x.js` is where
 *     these files are supposed to live, and `fetch_issues.py` is an issue dump
 *     rather than a patch script — it is covered by neither pattern, so the
 *     file may be removed or moved under `.scratch/` without the guard needing
 *     a special case either way.
 *
 * Run from the repository root: `pnpm test` (→ `node --test tests/*.test.mjs`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** A one-off patch/fix script committed at the root: `patch_*.js`, `fix_*.js`. */
const ROOT_SCRATCH_SCRIPT = /^(?:patch|fix)_.*\.js$/;

/**
 * Whether a repository-relative path is a root-level scratch script.
 *
 * Only paths with no directory separator are considered: a `fix_*.js` inside
 * `scripts/` or `packages/` is ordinary code and must not trip the guard.
 */
function isRootScratchScript(trackedPath) {
  if (trackedPath.includes('/')) return false;
  return ROOT_SCRATCH_SCRIPT.test(trackedPath);
}

/**
 * Every path in the index, NUL-separated so that a path containing whitespace
 * survives. `git ls-files` is run from the repository root with no interpolated
 * arguments.
 */
function trackedPaths() {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split('\0').filter(Boolean);
}

test('no root-level patch_*.js or fix_*.js is tracked', () => {
  const offenders = trackedPaths().filter(isRootScratchScript);

  assert.deepEqual(
    offenders,
    [],
    `Tracked scratch scripts at the repository root:\n` +
      offenders.map((path) => `  - ${path}`).join('\n') +
      `\n\nThese are one-off agent edits, not part of any package: nothing imports them ` +
      `and no script in package.json references them. Remove them from the index with ` +
      `\`git rm\` (deleting only the working tree leaves them tracked and keeps this ` +
      `check red). Anything of this shape that is still needed belongs under ` +
      `.scratch/, which .gitignore covers. See CONTRIBUTING.md.`,
  );
});

test('the matcher covers root patch/fix scripts and nothing else', () => {
  const guarded = [
    'patch_ci.js',
    'patch_route.js',
    'patch_workspace.js',
    'fix_type.js',
    'fix_type2.js',
  ];

  for (const path of guarded) {
    assert.equal(isRootScratchScript(path), true, `${path} should be guarded`);
  }

  const unaffected = [
    // Not a patch/fix script: an issue dump, removed in #789 and allowed to
    // live under .scratch/ later without the guard needing a new case.
    'fetch_issues.py',
    // Same name, ordinary location: code in a package is not scratch.
    'scripts/patch_ci.js',
    'packages/sdk/fix_type.js',
    // The place these files are supposed to go.
    '.scratch/fix_type.js',
    // The guard is about the tracked scratch form, not every file starting
    // with the same prefix.
    'patch_ci.mjs',
    'patch_notes.md',
    'not_patch_ci.js',
  ];

  for (const path of unaffected) {
    assert.equal(isRootScratchScript(path), false, `${path} should not be guarded`);
  }
});
