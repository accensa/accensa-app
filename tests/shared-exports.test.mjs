import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');
const SHARED_DIR = join(REPO_ROOT, 'packages', 'shared');
const MANIFEST_PATH = join(SHARED_DIR, 'package.json');

test('shared package exports map declares and resolves all subpaths (#768)', () => {
  const content = readFileSync(MANIFEST_PATH, 'utf-8');
  const manifest = JSON.parse(content);

  assert.ok(manifest.exports, 'package.json must declare an exports map');
  const exportKeys = Object.keys(manifest.exports);

  // Assert . is listed first
  assert.equal(exportKeys[0], '.', 'Root export "." must be listed first in exports map');

  // Assert ./tokens is present and mapped to ./src/tokens/index.ts
  assert.equal(
    manifest.exports['./tokens'],
    './src/tokens/index.ts',
    './tokens export must point to ./src/tokens/index.ts',
  );

  // Assert every declared target exists on disk relative to packages/shared/
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    const resolvedPath = join(SHARED_DIR, target);
    assert.ok(
      existsSync(resolvedPath),
      `Export target for "${subpath}" does not exist on disk at ${resolvedPath}`,
    );
  }

  // Assert every directory under src/* with an index.ts has a corresponding export entry
  const srcDir = join(SHARED_DIR, 'src');
  const entries = readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const indexFile = join(srcDir, entry.name, 'index.ts');
      if (existsSync(indexFile)) {
        const expectedSubpath = `./${entry.name}`;
        assert.ok(
          expectedSubpath in manifest.exports,
          `Directory src/${entry.name} has index.ts but is missing from exports map as "${expectedSubpath}"`,
        );
        assert.equal(
          manifest.exports[expectedSubpath],
          `./src/${entry.name}/index.ts`,
          `Export for "${expectedSubpath}" must point to "./src/${entry.name}/index.ts"`,
        );
      }
    }
  }
});
