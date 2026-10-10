/**
 * Tests for the repository's `/.prettierrc.json5`.
 *
 * ## Testing strategy
 *
 * The config file is JSON5 data, not code. It declares five scalar options and
 * contains no functions, branches or statements to execute, so line/branch
 * coverage instrumentation has nothing to measure — "95% coverage" is not a
 * meaningful target for a data file. What can actually drift or break, and what
 * this suite pins instead:
 *
 *  1. File integrity — the file must parse under Prettier's own JSON5 loader,
 *     have a plain-object root, no BOM, no nested values, and no duplicate keys
 *     (the loader keeps the last one, so a stray second `semi:` silently wins).
 *     It must also already be formatted under its own settings, so that
 *     `pnpm format:check` cannot fail on the config file itself.
 *
 *  2. Option catalogue — Prettier silently ignores options it does not know. A
 *     typo such as `trailingCommas` changes nothing and reports no error, so
 *     every key is checked against Prettier's own option registry from
 *     `getSupportInfo()` rather than a hand-copied list that goes stale.
 *
 *  3. Value schema — types, integer ranges and enum choices are validated
 *     against that same published metadata. This matters because
 *     `resolveConfig()` does *not* validate: it hands back
 *     `{ trailingComma: "bogus" }` without complaint and only `format()` fails
 *     later, at the point where the offending value is hard to trace back.
 *
 *  4. Resolution — this file, and only this file, is the configuration Prettier
 *     uses for every path in the workspace, and no competing config source
 *     (`.editorconfig`, `prettier.config.*`, a stray `.prettierrc`, a
 *     `prettier` key in `package.json`) shadows it.
 *
 *  5. Behaviour — one case per declared option proves the option has the
 *     stated effect on real output, and a second case proves the effect
 *     disappears when the option is flipped, i.e. that the option is what is
 *     producing it. `every declared option has a behaviour case` makes the
 *     coverage contract executable: adding an option to the config without a
 *     behaviour case fails this suite.
 *
 *  6. Failure modes — malformed JSON5, an invalid value, and a config module
 *     that throws are each exercised against a temporary config directory,
 *     asserting exactly where Prettier surfaces the error (and, for unknown
 *     keys, that it surfaces nothing at all — which is why step 2 exists).
 *
 * Run from the repository root: `pnpm test` (→ `node --test tests/*.test.mjs`).
 */

import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_NAME = '.prettierrc.json5';
const CONFIG_PATH = path.join(ROOT, CONFIG_NAME);

/** Directories that never contain source we own, and that would swamp the walk. */
const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.docusaurus',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'storybook-static',
]);

/** Lazily read the file so a missing file fails one test, not the whole file. */
function readRaw() {
  return fs.readFileSync(CONFIG_PATH, 'utf8');
}

/**
 * Parse the config exactly the way Prettier does, rather than with a second
 * JSON5 parser this suite would have to keep in sync with the real one. A
 * syntax error rejects, which is what the `parses under Prettier's own loader`
 * case asserts.
 */
function readConfig() {
  return prettier.resolveConfig(CONFIG_PATH);
}

/**
 * Drop SGR escape sequences from a message. Prettier colours its
 * option-validation errors whenever the process looks like an interactive
 * terminal, and CI counts — the workflow log renders the same failure as
 * `Invalid ESC[31mtrailingCommaESC[39m value`. Assertions compare the words,
 * not the decoration, so the two environments agree.
 */
function stripAnsi(text) {
  return String(text).replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * Await `run` and return the rejection's message with colours removed, failing
 * the test if it resolves instead.
 */
async function rejectionMessage(run) {
  try {
    await run();
  } catch (error) {
    return stripAnsi(error instanceof Error ? error.message : String(error));
  }
  return assert.fail('expected the call to reject, but it resolved');
}

/**
 * Remove `//` and block comments from JSON5 source without eating comment
 * markers that appear inside string literals — a value such as
 * `https://example.com` must not truncate the rest of the line. Needed because
 * the duplicate-key check has to read raw source, and the config now carries
 * prose comments that contain `key:`-shaped text of their own.
 */
function stripComments(source) {
  let out = '';
  let index = 0;
  let quote = null;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (quote !== null) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

/**
 * Every config key in JSON5 source, in order, with comments excluded. Handles
 * quoted (`"semi"`, `'semi'`) and bare (`semi`) keys, which JSON5 allows
 * interchangeably.
 *
 * Keys are only recognised in key position — directly after `{` or `,`, which
 * is where the formatter puts them. Anchoring there is what stops a `key:`
 * inside a string value (a URL, say) from being read as an option name.
 */
function scanKeys(source) {
  const keyPattern = /(?:[{,])\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*:/g;
  return [...stripComments(source).matchAll(keyPattern)].map(
    (match) => match[1] ?? match[2] ?? match[3],
  );
}

/** The options Prettier actually knows, keyed by option name. */
let supportInfo;
before(async () => {
  supportInfo = await prettier.getSupportInfo();
});
after(() => {
  supportInfo = undefined;
});

const knownOptions = () => new Map(supportInfo.options.map((o) => [o.name, o]));

/**
 * Resolve the config as Prettier would for a file inside this repository.
 * The input path does not need to exist; only its location in the tree matters.
 */
function resolveRepoConfig(filePath = 'src/index.js') {
  return prettier.resolveConfig(path.join(ROOT, filePath));
}

/**
 * Format with the repository's own settings merged in, so a test can override a
 * single option (the "flip" cases) without losing the rest of the config.
 */
async function formatWithRepoConfig(source, overrides = {}, filePath = 'src/index.js') {
  const resolved = await resolveRepoConfig(filePath);
  return prettier.format(source, { parser: 'babel', ...resolved, ...overrides });
}

/** Prettier caches resolved config per path; every test wants a cold read. */
beforeEach(() => prettier.clearConfigCache());
afterEach(() => prettier.clearConfigCache());

/**
 * A single-line call expression whose formatted length is `target` characters
 * (prettier appends the statement semicolon). Used to pin `printWidth`: the
 * result is longer than Prettier's default 80 but shorter than our 100, so it
 * only survives as one line if `printWidth: 100` is actually in force.
 */
function widgetCall(target) {
  const prefix = "renderDashboardWidget({ label: '";
  const suffix = "' })";
  const semicolon = 1;
  const filler = target - prefix.length - suffix.length - semicolon;
  assert.ok(filler > 0, 'target length too small for the fixture shape');
  return `${prefix}${'x'.repeat(filler)}${suffix}`;
}

/**
 * One behavioural case per option declared in `.prettierrc.json5`.
 *
 * `fixture` is source that makes the option visible; `check` asserts the
 * option's stated effect on the formatted result; `flip` overrides the option
 * to prove the effect is caused by it and not by something else. The
 * `every declared option has a behaviour case` test compares these keys against
 * the file's own key set, so this table cannot silently fall behind.
 */
const OPTION_CASES = {
  semi: {
    summary: 'statements are terminated with a semicolon',
    fixture: 'const answer = 42',
    check: (out) => assert.match(out, /const answer = 42;\n/),
    flip: { semi: false },
  },
  singleQuote: {
    summary: 'string literals use single quotes',
    fixture: 'const greeting = "hello";',
    check: (out) => {
      assert.match(out, /'hello'/);
      assert.doesNotMatch(out, /"hello"/);
    },
    flip: { singleQuote: false },
  },
  trailingComma: {
    summary: 'multi-line constructs end with a trailing comma',
    // The newline after `{` is what keeps this object multi-line, which is the
    // only shape in which a trailing comma is visible at all.
    fixture: 'const settings = {\n  locale: "en-US",\n  strict: true\n};',
    check: (out) => assert.match(out, /strict: true,\n\};\n/),
    flip: { trailingComma: 'none' },
  },
  printWidth: {
    summary: 'lines wrap at 100 columns rather than Prettier’s default 80',
    fixture: widgetCall(95),
    check: (out) => {
      const lines = out.trimEnd().split('\n');
      assert.equal(lines.length, 1, 'expected the 95-column line to stay unwrapped');
      assert.equal(lines[0].length, 95);
    },
    flip: { printWidth: 80 },
  },
  tabWidth: {
    summary: 'each indentation level is two spaces',
    fixture: 'function f() { if (a) { b(); } }',
    check: (out) => assert.match(out, /\n {2}if \(a\) \{\n {4}b\(\);\n {2}\}\n\}/),
    flip: { tabWidth: 4 },
  },
};

/**
 * Exercises all five options at once, so the interactions between them are
 * covered too rather than only in isolation. Every assertion below maps to
 * exactly one declared option.
 */
const COMBINED_FIXTURE = [
  'import { renderWidget } from "./widget.js";',
  '',
  'export function renderDashboard(options) {',
  '  const items = options.items.map((item) => ({ id: item.id, label: item.label }));',
  '  const label = formatLabel(options.tenantName, options.locale, options.timezone);',
  '  if (items.length === 0) { return null; }',
  '  return renderWidget({',
  '    title: options.title,',
  '    items: items,',
  '    label: label',
  '  });',
  '}',
].join('\n');

describe(`${CONFIG_NAME} — file integrity`, () => {
  test('exists and is not empty', () => {
    assert.ok(readRaw().length > 0, `${CONFIG_NAME} is empty`);
  });

  test('parses under Prettier’s own JSON5 loader', async () => {
    // JSON5 has no `JSON.parse`, so Prettier's loader is the parser of record.
    // The cases below would otherwise fail with a far less readable error.
    await assert.doesNotReject(() => readConfig(), `${CONFIG_NAME} does not parse`);
  });

  test('has no UTF-8 BOM', () => {
    assert.ok(!readRaw().startsWith('﻿'), 'unexpected BOM: editors add this silently');
  });

  test('root value is a plain object, not an array, null or scalar', async () => {
    // `resolveConfig` coerces an array root to `{"0": …}`, so only the raw
    // first character can show that the file does not open with `[`. Comments
    // come off first — the file opens with a documentation block.
    assert.ok(stripComments(readRaw()).trimStart().startsWith('{'), 'config must open with {');
    const value = await readConfig();
    assert.equal(typeof value, 'object');
    assert.notEqual(value, null);
    assert.ok(!Array.isArray(value));
  });

  test('is flat: no nested objects or arrays', async () => {
    for (const [key, entry] of Object.entries(await readConfig())) {
      // `typeof null` is "object", so this also rejects null values.
      assert.notEqual(
        typeof entry,
        'object',
        `option "${key}" is nested or null; keep ${CONFIG_NAME} flat`,
      );
    }
  });

  test('has no duplicate keys', () => {
    // The loader keeps the last duplicate, so the resolved object cannot
    // reveal them. Comments are stripped first or the prose would be scanned
    // for `key:`-shaped text. Only sound because the config is flat (above).
    const keys = scanKeys(readRaw());
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    assert.deepEqual(duplicates, [], `duplicate keys: ${duplicates.join(', ')}`);
  });

  test('the duplicate-key scan actually detects duplicates', () => {
    // Guards the scan above: if `stripComments` or the key regex ever stop
    // working, the failure mode is a silent *false negative* — a duplicate key
    // would ship unnoticed. This pins both directions.
    const sample = [
      '{',
      '  // semi: documented prose that must not be scanned',
      '  /* trailingComma: block comment too */',
      '  semi: true,',
      '  semi: false,',
      '  docs: "https://example.com/#not-a-comment",',
      '}',
    ].join('\n');

    const keys = scanKeys(sample);
    assert.deepEqual(keys, ['semi', 'semi', 'docs'], `unexpected scan result: ${keys.join(', ')}`);
    assert.ok(keys.includes('semi'), 'scan failed to find a duplicate key');
  });

  test('ends with exactly one newline and has no trailing whitespace', () => {
    const raw = readRaw();
    assert.ok(raw.endsWith('\n'), 'missing final newline');
    assert.ok(!raw.endsWith('\n\n'), 'extra blank line at end of file');
    assert.doesNotMatch(raw, /[ \t]+$/m, 'trailing whitespace on a line');
  });

  test('is already formatted under its own settings', async () => {
    // Guarantees `pnpm format:check` cannot fail on this file, and that the
    // config is self-applying: prettier formats the config with the config.
    const raw = readRaw();
    const formatted = await prettier.format(raw, { parser: 'json5', ...(await readConfig()) });
    assert.equal(formatted, raw, `${CONFIG_NAME} is not idempotent under its own settings`);
  });
});

describe(`${CONFIG_NAME} — option catalogue`, () => {
  test('declares exactly the expected options', async () => {
    const expected = ['printWidth', 'semi', 'singleQuote', 'tabWidth', 'trailingComma'];
    assert.deepEqual(Object.keys(await readConfig()).sort(), [...expected].sort());
  });

  test('every key is an option Prettier actually knows', async () => {
    // The load-bearing assertion of the whole suite: Prettier ignores unknown
    // options without warning, so a typo would otherwise be a silent no-op.
    const known = knownOptions();
    const unknown = Object.keys(await readConfig()).filter((key) => !known.has(key));
    assert.deepEqual(
      unknown,
      [],
      `unknown option(s), silently ignored by Prettier: ${unknown.join(', ')}`,
    );
  });

  test('records which options are deliberate overrides of Prettier’s defaults', async () => {
    // Tripwire, not a rule: if a Prettier major changes a default (v2 → v3
    // flipped trailingComma from "es5" to "all"), this test names the options
    // whose meaning moved so the change is reviewed rather than absorbed.
    const config = await readConfig();
    const known = knownOptions();
    const nonDefaults = Object.keys(config)
      .filter((key) => JSON.stringify(config[key]) !== JSON.stringify(known.get(key).default))
      .sort();

    // Two options move away from Prettier's defaults (printWidth 100 vs 80,
    // singleQuote true vs false); the other three are explicit pins that
    // happen to match. Both lists are asserted so the split is visible in the
    // failure message rather than inferred.
    assert.deepEqual(nonDefaults, ['printWidth', 'singleQuote']);
    assert.deepEqual(
      Object.keys(config)
        .filter((key) => !nonDefaults.includes(key))
        .sort(),
      ['semi', 'tabWidth', 'trailingComma'],
    );
  });
});

describe(`${CONFIG_NAME} — value schema`, () => {
  test('every value has the type Prettier declares for that option', async () => {
    const known = knownOptions();

    for (const [key, value] of Object.entries(await readConfig())) {
      const option = known.get(key);
      switch (option.type) {
        case 'boolean':
          assert.equal(typeof value, 'boolean', `${key} must be a boolean`);
          break;
        case 'int':
          assert.ok(
            Number.isInteger(value),
            `${key} must be an integer, got ${JSON.stringify(value)}`,
          );
          break;
        case 'choice':
          assert.equal(typeof value, 'string', `${key} must be a string`);
          break;
        case 'string':
          assert.equal(typeof value, 'string', `${key} must be a string`);
          break;
        default:
          assert.fail(`option ${key} has unhandled type "${option.type}"; extend this test`);
      }
    }
  });

  test('every choice option uses one of Prettier’s allowed values', async () => {
    const known = knownOptions();
    for (const [key, value] of Object.entries(await readConfig())) {
      const option = known.get(key);
      if (option.type !== 'choice') continue;
      const choices = option.choices.map((choice) => choice.value);
      assert.ok(
        choices.includes(value),
        `${key}=${JSON.stringify(value)} not in ${choices.join(' | ')}`,
      );
    }
  });

  test('every integer option is inside Prettier’s declared range', async () => {
    const known = knownOptions();
    for (const [key, value] of Object.entries(await readConfig())) {
      const option = known.get(key);
      if (option.type !== 'int' || !option.range) continue;
      const { start, end } = option.range;
      assert.ok(value >= start, `${key}=${value} is below the minimum ${start}`);
      if (end !== null) assert.ok(value <= end, `${key}=${value} is above the maximum ${end}`);
    }
  });

  test('pins the deliberate style decisions', async () => {
    // Prettier enforces none of this itself; these are project choices, so the
    // test makes changing them a deliberate, reviewed edit.
    const config = await readConfig();
    assert.equal(
      config.printWidth,
      100,
      'printWidth is a project convention, not a Prettier default',
    );
    assert.equal(config.tabWidth, 2, 'tabWidth is a project convention, not a Prettier default');
    assert.equal(config.semi, true, 'semicolons are required');
    assert.equal(config.singleQuote, true, 'single quotes are required');
    assert.equal(config.trailingComma, 'all', 'trailing commas are required everywhere');
  });
});

describe(`${CONFIG_NAME} — resolution`, () => {
  test('Prettier resolves this file as the config for the repository', async () => {
    assert.equal(await prettier.resolveConfigFile(), CONFIG_PATH);
  });

  test('a source file resolves to the same options as the config file itself', async () => {
    // Two independent entry points into the loader must agree, otherwise
    // something is intercepting resolution for source paths.
    assert.deepEqual(await resolveRepoConfig(), await readConfig());
  });

  test('applies to files in nested workspace packages', async () => {
    const nested = [
      'apps/web/src/lib/money.ts',
      'packages/sdk/index.ts',
      'scripts/reconcile-payments/cli.mjs',
    ];
    for (const filePath of nested) {
      assert.deepEqual(
        await resolveRepoConfig(filePath),
        await readConfig(),
        `config not applied to ${filePath}`,
      );
    }
  });

  test('is not overridden by another config source', async () => {
    // A second source (an .editorconfig, a `prettier` key in package.json)
    // would win silently for some paths; resolving several depths proves none
    // of them does.
    const config = await readConfig();
    for (const filePath of ['README.md', '.github/workflows/ci.yml', 'apps/web/src/lib/money.ts']) {
      const resolved = await prettier.resolveConfig(path.join(ROOT, filePath));
      for (const [key, value] of Object.entries(config)) {
        assert.equal(
          resolved[key],
          value,
          `${key} overridden for ${filePath}: ${JSON.stringify(resolved[key])}`,
        );
      }
    }
  });

  test('no competing config file exists anywhere in the repository', () => {
    const found = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const relativePath = path
            .relative(ROOT, path.join(dir, entry.name))
            .split(path.sep)
            .join('/');
          if (relativePath === '.kilo/worktrees' || relativePath === '.claude/worktrees') {
            continue;
          }
          if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
          continue;
        }
        if (
          entry.name === '.editorconfig' ||
          entry.name === 'prettier.config.js' ||
          entry.name === 'prettier.config.mjs'
        ) {
          found.push(path.relative(ROOT, path.join(dir, entry.name)));
        }
        // Any other Prettier config — including a stray `.prettierrc`, which
        // some editors and contributors will recreate by habit — is a second
        // source of truth. Which one wins depends on Prettier's search order,
        // so none of them may exist.
        if (entry.name.startsWith('.prettierrc') && entry.name !== CONFIG_NAME) {
          found.push(path.relative(ROOT, path.join(dir, entry.name)) + ' (competing config)');
        }
        if (entry.name === CONFIG_NAME && dir !== ROOT) {
          found.push(
            path.relative(ROOT, path.join(dir, entry.name)) + ' (nested, shadows the root config)',
          );
        }
        if (entry.name === 'package.json') {
          const pkg = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
          if (pkg.prettier !== undefined) {
            found.push(path.relative(ROOT, path.join(dir, entry.name)) + ' (prettier key)');
          }
        }
      }
    };
    walk(ROOT);
    assert.deepEqual(found, [], `competing Prettier config(s) found: ${found.join(', ')}`);
  });
});

describe(`${CONFIG_NAME} — behaviour`, () => {
  // Generated from OPTION_CASES so the assertions cannot drift apart from the
  // declared option set. The coverage test below depends on this same table.
  for (const [option, testCase] of Object.entries(OPTION_CASES)) {
    test(`${option}: ${testCase.summary}`, async () => {
      testCase.check(await formatWithRepoConfig(testCase.fixture));
    });

    test(`${option} is load-bearing: flipping it changes the output`, async () => {
      const base = await formatWithRepoConfig(testCase.fixture);
      const flipped = await formatWithRepoConfig(testCase.fixture, testCase.flip);
      assert.notEqual(
        flipped,
        base,
        `${option} flipped to ${JSON.stringify(testCase.flip[option])} produced identical output — ` +
          `the option has no effect, so the ${CONFIG_NAME} value is not doing anything`,
      );
    });
  }

  test('every declared option has a behaviour case', async () => {
    // The executable form of "95% coverage": key coverage is 100%, and it is
    // computed from the config file itself rather than asserted by hand.
    const declared = new Set(Object.keys(await readConfig()));
    const covered = new Set(Object.keys(OPTION_CASES));
    const missing = [...declared].filter((key) => !covered.has(key));
    const stale = [...covered].filter((key) => !declared.has(key));
    assert.deepEqual(
      missing,
      [],
      `option(s) declared in ${CONFIG_NAME} with no behaviour test: ${missing.join(', ')}`,
    );
    assert.deepEqual(
      stale,
      [],
      `behaviour test(s) for an option no longer in ${CONFIG_NAME}: ${stale.join(', ')}`,
    );
  });

  test('all options together produce output that satisfies every one of them', async () => {
    const out = await formatWithRepoConfig(COMBINED_FIXTURE);
    const lines = out.trimEnd().split('\n');
    const nonEmpty = lines.filter((line) => line.length > 0);

    // printWidth: nothing exceeds 100 columns.
    const tooWide = lines.filter((line) => line.length > 100);
    assert.deepEqual(tooWide, [], 'lines exceed printWidth: 100');

    // tabWidth: spaces only, and every indent level is a multiple of 2.
    for (const line of nonEmpty) {
      assert.ok(!line.includes('\t'), `tab character in output: ${JSON.stringify(line)}`);
      const indent = line.match(/^[ ]*/)[0].length;
      assert.equal(indent % 2, 0, `indent not a multiple of tabWidth: ${JSON.stringify(line)}`);
    }

    // semi: every line is a terminated statement or a block boundary.
    for (const line of nonEmpty) {
      assert.match(line, /[;{},]$/, `unterminated line: ${JSON.stringify(line)}`);
    }

    // singleQuote: no double-quoted string survives (the fixture has no JSX,
    // where Prettier deliberately keeps double quotes).
    assert.doesNotMatch(out, /"/, 'double-quoted string survived');

    // trailingComma: the final property in the multi-line call carries a comma.
    assert.match(
      out,
      /label: label,\n {2}\}\);\n/,
      'missing trailing comma before the closing call paren',
    );
  });

  test('is idempotent: formatting twice equals formatting once', async () => {
    for (const fixture of [
      COMBINED_FIXTURE,
      widgetCall(95),
      'const a = { b: 1 };',
      'if (a) { b() }',
    ]) {
      const once = await formatWithRepoConfig(fixture);
      const twice = await formatWithRepoConfig(once);
      assert.equal(twice, once, `not idempotent for:\n${fixture}`);
    }
  });

  test('is deterministic: the same input formats to the same output', async () => {
    const first = await formatWithRepoConfig(COMBINED_FIXTURE);
    const second = await formatWithRepoConfig(COMBINED_FIXTURE);
    assert.equal(first, second);
  });

  test('applies to Markdown and YAML as well as JavaScript', async () => {
    // The options are language-agnostic; a config that only shaped JS would be
    // half a config. tabWidth and printWidth are the visible ones in prose.
    const resolved = await resolveRepoConfig();
    const md = await prettier.format('- one\n- two\n', { parser: 'markdown', ...resolved });
    assert.equal(md, '- one\n- two\n');

    const yaml = await prettier.format('a:\n  b: 1\n', { parser: 'yaml', ...resolved });
    assert.equal(yaml, 'a:\n  b: 1\n');
    assert.ok(!yaml.includes('\t'));
  });
});

describe(`${CONFIG_NAME} — failure modes`, () => {
  const tempDirs = [];
  after(() => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Write a temporary config and return a path inside it. */
  function withTempConfig(name, contents) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prettierrc-test-'));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, name), contents);
    prettier.clearConfigCache();
    return path.join(dir, 'source.js');
  }

  test('malformed JSON5 is reported by resolveConfig', async () => {
    const file = withTempConfig(CONFIG_NAME, '{ "semi": true,, }');
    await assert.rejects(
      () => prettier.resolveConfig(file),
      /Error/,
      'malformed config resolved without complaint',
    );
  });

  test('an invalid value passes resolveConfig but is rejected at format time', async () => {
    // Documents the gap this suite's schema test closes: config loading does
    // not validate, so a bad value only surfaces once formatting starts.
    const file = withTempConfig(CONFIG_NAME, '{ "trailingComma": "bogus" }');
    const resolved = await prettier.resolveConfig(file);
    assert.deepEqual(resolved, { trailingComma: 'bogus' });

    const message = await rejectionMessage(() =>
      prettier.format('const a = 1;', { parser: 'babel', ...resolved }),
    );
    assert.match(message, /Invalid trailingComma value/);
  });

  test('a wrong-typed value is rejected at format time', async () => {
    const file = withTempConfig(CONFIG_NAME, '{ "printWidth": "wide" }');
    const resolved = await prettier.resolveConfig(file);
    assert.deepEqual(resolved, { printWidth: 'wide' });

    const message = await rejectionMessage(() =>
      prettier.format('const a = 1;', { parser: 'babel', ...resolved }),
    );
    assert.match(message, /Invalid printWidth value/);
  });

  test('a config module that throws surfaces its error', async () => {
    const file = withTempConfig('.prettierrc.js', 'throw new Error("boom");');
    await assert.rejects(() => prettier.resolveConfig(file), /boom/);
  });

  test('an unknown option is ignored silently — which is why the catalogue test exists', async () => {
    const file = withTempConfig(CONFIG_NAME, '{ "trailingCommas": "all" }');
    const resolved = await prettier.resolveConfig(file);
    assert.deepEqual(
      resolved,
      { trailingCommas: 'all' },
      'config loader should pass the typo through',
    );

    // No throw, no warning: the typo is indistinguishable from no config at all.
    const out = await prettier.format('const a = { b: 1 };', {
      parser: 'babel',
      ...resolved,
      trailingComma: 'es5',
    });
    assert.equal(typeof out, 'string');
  });

  test('an empty config resolves to an empty object rather than failing', async () => {
    const file = withTempConfig(CONFIG_NAME, '{}');
    assert.deepEqual(await prettier.resolveConfig(file), {});
  });
});

describe(`${CONFIG_NAME} — repository integration`, () => {
  test('the config file itself is checked by format:check (not ignored)', async () => {
    const info = await prettier.getFileInfo(CONFIG_PATH, {
      ignorePath: path.join(ROOT, '.prettierignore'),
    });
    assert.equal(
      info.ignored,
      false,
      `${CONFIG_NAME} is ignored, so pnpm format:check does not cover it`,
    );
    assert.equal(info.inferredParser, 'json5', `${CONFIG_NAME} has no inferred parser`);
  });

  test('the file is covered by the repository test script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(
      pkg.scripts?.test,
      'root package.json has no "test" script; these tests would never run',
    );
    assert.match(
      pkg.scripts.test,
      /tests/,
      'root test script does not include the tests/ directory',
    );
  });
});
