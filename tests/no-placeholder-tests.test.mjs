import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

// Drop comments and string/template literals so mentions of `expect(` there do not count.
function hasAssertion(source) {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""');
  return /\b(expect\(|assert\.|assert\(|test\()/.test(code);
}

test('no *.test.ts under src/ is a placeholder without assertions', () => {
  let files = [];
  try {
    files = walk(srcDir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const placeholders = files
    .filter((f) => f.endsWith('.test.ts'))
    .filter((f) => !hasAssertion(readFileSync(f, 'utf8')));
  assert.deepEqual(
    placeholders,
    [],
    `placeholder test files with no assertions: ${placeholders.join(', ')}`,
  );
});
