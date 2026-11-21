import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const SOURCE = /\.(ts|tsx|js|mjs)$/;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') return [];
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

test('no zero-byte source files under src/', () => {
  let files = [];
  try {
    files = walk(srcDir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const empty = files
    .filter((f) => SOURCE.test(f))
    .map((f) => ({ f, size: statSync(f).size }))
    .filter(({ size }) => size === 0)
    .map(({ f, size }) => `${f} (${size} bytes)`);
  assert.deepEqual(empty, [], `empty source stubs: ${empty.join(', ')}`);
});
