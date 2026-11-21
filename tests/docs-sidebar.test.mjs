import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');
const SIDEBARS_PATH = join(REPO_ROOT, 'apps', 'docs', 'sidebars.ts');
const DOCS_DIR = join(REPO_ROOT, 'apps', 'docs', 'docs');

/**
 * Extracts all doc IDs from sidebars.ts.
 * Strips link objects (containing `href:`) to avoid checking external repository links.
 * Returns array of doc ID strings.
 */
export function extractSidebarDocIds(content) {
  // Strip external link objects { ... href: ... }
  const withoutLinks = content.replace(/\{[^{}]*href:[^{}]*\}/gs, '');

  // Extract doc IDs: any quoted string that is NOT a value for type:, label:, href:
  const matches = [
    ...withoutLinks.matchAll(/(?<!(?:type|label|href)\s*:\s*)["']([a-zA-Z0-9_\-/]+)["']/g),
  ];
  return matches.map((m) => m[1]).filter((id) => id !== 'category' && !id.startsWith('@'));
}

/**
 * Resolves a doc ID to its candidate file path under apps/docs/docs/.
 * Checks: <id>.mdx, <id>.md, <id>/index.mdx, <id>/index.md
 */
export function resolveDocFile(docsDir, docId) {
  const candidates = [
    join(docsDir, `${docId}.mdx`),
    join(docsDir, `${docId}.md`),
    join(docsDir, docId, 'index.mdx'),
    join(docsDir, docId, 'index.md'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

test('every doc id in sidebars.ts resolves to a document file under apps/docs/docs/ (#775)', () => {
  const content = readFileSync(SIDEBARS_PATH, 'utf-8');
  const docIds = extractSidebarDocIds(content);

  assert.ok(docIds.length > 0, 'sidebars.ts must declare at least one doc id');
  assert.ok(docIds.includes('sdk/playground'), 'sdk/playground must be present in sidebars.ts');

  const missing = [];
  for (const docId of docIds) {
    const resolved = resolveDocFile(DOCS_DIR, docId);
    if (!resolved) {
      missing.push(docId);
    }
  }

  assert.deepEqual(
    missing,
    [],
    `Sidebar doc IDs with no matching document file under apps/docs/docs/: ${missing.join(', ')}`,
  );
});

test('resolveDocFile detects a deliberately broken doc id (#775)', () => {
  const brokenId = 'nonexistent/broken-doc';
  const resolved = resolveDocFile(DOCS_DIR, brokenId);
  assert.equal(
    resolved,
    null,
    `Expected null for deliberately broken doc id "${brokenId}", got ${resolved}`,
  );
});
