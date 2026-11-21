import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOYMENT = path.join(ROOT, 'DEPLOYMENT.md');

function splitTableRow(line) {
  const separators = [];
  let inCode = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '`') {
      inCode = !inCode;
      continue;
    }
    if (char === '|' && !inCode) separators.push(index);
  }

  if (separators.length === 0) return null;
  const cells = [];
  let start = 0;
  for (const separator of separators) {
    cells.push(line.slice(start, separator).trim());
    start = separator + 1;
  }
  cells.push(line.slice(start).trim());
  if (cells[0] === '') cells.shift();
  if (cells.at(-1) === '') cells.pop();
  return cells;
}

function isSeparatorRow(cells) {
  return cells !== null && cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function readTables(markdown) {
  const lines = markdown.split(/\r?\n/);
  const tables = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    const headers = splitTableRow(lines[index]);
    const separators = splitTableRow(lines[index + 1]);
    if (!headers || !isSeparatorRow(separators) || headers.length !== separators.length) continue;

    const rows = [];
    let cursor = index + 2;
    while (cursor < lines.length && lines[cursor].trimStart().startsWith('|')) {
      const cells = splitTableRow(lines[cursor]);
      if (cells && cells.length === headers.length) rows.push({ line: cursor + 1, cells });
      cursor += 1;
    }
    tables.push({ headerLine: index + 1, headers, rows });
    index = cursor - 1;
  }

  return tables;
}

function duplicateFirstColumnValues(tables) {
  const duplicates = [];
  for (const table of tables) {
    const firstLineByValue = new Map();
    for (const row of table.rows) {
      const value = row.cells[0];
      if (firstLineByValue.has(value)) {
        duplicates.push({
          value,
          firstLine: firstLineByValue.get(value),
          duplicateLine: row.line,
        });
      } else {
        firstLineByValue.set(value, row.line);
      }
    }
  }
  return duplicates;
}

describe('DEPLOYMENT.md environment-variable table keys', () => {
  test('no table repeats a first-column value', () => {
    const markdown = fs.readFileSync(DEPLOYMENT, 'utf8');
    assert.deepEqual(duplicateFirstColumnValues(readTables(markdown)), []);
  });

  test('the private signing key is documented once with both homes and duties', () => {
    const markdown = fs.readFileSync(DEPLOYMENT, 'utf8');
    const rows = readTables(markdown)
      .flatMap(({ rows }) => rows)
      .filter(({ cells }) => cells[0] === '`ACCENSA_PRIVATE_KEY_HEX`');

    assert.equal(rows.length, 1, 'ACCENSA_PRIVATE_KEY_HEX must have exactly one row');
    assert.match(rows[0].cells[1], /Merchant server \+ Vercel \(`web`\)/);
    assert.match(rows[0].cells[2], /same Ed25519 hex seed/);
    assert.match(rows[0].cells[2], /settlement attribution/);
    assert.match(rows[0].cells[2], /`\/api\/hook\/settle`/);
    assert.match(rows[0].cells[2], /fails closed/);
  });
});
