// Unit tests for the SDK's tsup build config (`tsup.config.ts`).
//
// Named `build-config.test.ts` rather than `tsup.config.test.ts` on purpose:
// vitest's default `exclude` treats `*.config.*` as configuration files, so a
// test named after the config would be silently skipped by `pnpm test` — and by
// CI with it.
//
// Testing strategy:
//
//   1. The published bundles are asserted as a contract, not as a snapshot: the
//      options the package's `exports` map depends on (both formats, dts,
//      `dist`) are checked by name, so a change that would break consumers fails
//      here rather than in the packed-tarball job.
//   2. Every guard in `validateBundles` is exercised through the public function
//      with a temporary directory of real files, so the checks are tested the
//      way tsup invokes them rather than through a private helper.
//   3. Failure messages are asserted, because an unhelpful message is the same
//      failure mode as no message: each guard exists to replace a confusing
//      module-resolution error with one that names the file and the fix.

import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Options } from 'tsup';
import config, {
  BANNER,
  TsupConfigError,
  baseOptions,
  bundles,
  describeBuildPlan,
  packageRoot,
  resolveBundles,
  validateBundles,
} from './tsup.config';

/** A temp directory holding the given files, to stand in for the package root. */
function sourceRoot(files: string[] = ['index.ts', 'merkle.ts']): string {
  const root = mkdtempSync(join(tmpdir(), 'accensa-tsup-'));
  for (const file of files) writeFileSync(join(root, file), 'export {};\n');
  return root;
}

/** A minimal valid bundle, so each test varies one option at a time. */
const bundle = (overrides: Partial<Options> = {}): Options => ({
  entry: ['index.ts'],
  format: ['esm'],
  outDir: 'dist',
  ...overrides,
});

describe('published bundles', () => {
  it('builds the package entry and the standalone Merkle module', () => {
    expect(bundles).toHaveLength(2);
    expect(bundles[0].entry).toEqual(['index.ts']);
    expect(bundles[1].entry).toEqual({ merkle: 'merkle.ts' });
  });

  it('ships both formats the exports map advertises', () => {
    // package.json maps `import` and `require` for `.` and `./merkle`, so a
    // bundle built as esm-only is a broken install for half its consumers.
    for (const b of bundles) {
      expect(b.format).toEqual(['esm', 'cjs']);
      expect(b.dts).toBe(true);
      expect(b.outDir).toBe('dist');
    }
  });

  it('shares one options object between the bundles, so they cannot drift', () => {
    expect(bundles[0].format).toBe(bundles[1].format);
    expect(bundles[0].outDir).toBe(bundles[1].outDir);
    expect(bundles[0].target).toBe(bundles[1].target);
    expect(bundles[0].target).toBe(baseOptions.target);
  });

  it('carries the banner on the entry bundle only', () => {
    // The banner documents where the code came from; the Merkle bundle is
    // required from the main bundle or directly, and doubling it is noise.
    expect(bundles[0].banner).toEqual({ js: BANNER });
    expect(bundles[1].banner).toBeUndefined();
  });

  it('cleans the output directory exactly once', () => {
    expect(bundles[0].clean).toBe(true);
    expect(bundles[1].clean).toBeUndefined();
  });

  it('emits no sourcemaps or code splitting for a Node library', () => {
    for (const b of bundles) {
      expect(b.sourcemap).toBe(false);
      expect(b.splitting).toBe(false);
    }
  });

  it('is exported already validated', () => {
    expect(config).toEqual(validateBundles(bundles));
  });
});

describe('packageRoot', () => {
  it('resolves to the package directory, so entries are found from any cwd', () => {
    expect(existsSync(join(packageRoot(), 'package.json'))).toBe(true);
    expect(packageRoot().endsWith(join('packages', 'sdk'))).toBe(true);
  });

  it('finds the shipped entries when resolved from there', () => {
    expect(validateBundles(bundles, packageRoot())).toHaveLength(2);
  });
});

describe('describeBuildPlan', () => {
  it('names each entry, its output directory and its formats', () => {
    expect(describeBuildPlan(bundles)).toEqual([
      '@accensa/sdk: index.ts -> dist (esm, cjs)',
      '@accensa/sdk: merkle.ts -> dist (esm, cjs)',
    ]);
  });

  it('defaults the output directory to dist', () => {
    expect(describeBuildPlan([bundle({ outDir: undefined })])).toEqual([
      '@accensa/sdk: index.ts -> dist (esm)',
    ]);
  });

  it('describes a bundle with no entry or format without throwing', () => {
    // The plan is logged before validation failures would matter, so it must not
    // itself be a source of exceptions.
    expect(describeBuildPlan([{}])).toEqual(['@accensa/sdk:  -> dist ()']);
  });
});

describe('validateBundles', () => {
  it('returns the bundles unchanged, as a new list', () => {
    const root = sourceRoot();
    const result = validateBundles(bundles, root);
    expect(result).toEqual(bundles);
    expect(result).not.toBe(bundles);
  });

  it('rejects a config that would build nothing', () => {
    expect(() => validateBundles([], sourceRoot())).toThrow(TsupConfigError);
    expect(() => validateBundles([], sourceRoot())).toThrow(
      'no bundles configured; the package would publish nothing',
    );
  });

  it('rejects an entry file that is not there, naming the file and the root', () => {
    const root = sourceRoot(['index.ts']);
    expect(() => validateBundles([bundle({ entry: ['gone.ts'] })], root)).toThrow(TsupConfigError);
    expect(() => validateBundles([bundle({ entry: ['gone.ts'] })], root)).toThrow(
      `bundle "gone.ts" entry "gone.ts" does not exist in ${root}`,
    );
    expect(() => validateBundles([bundle({ entry: ['gone.ts'] })], root)).toThrow(
      /update the entry if the file was renamed or moved/,
    );
  });

  it('rejects an entry file missing from a named map', () => {
    const root = sourceRoot(['index.ts']);
    expect(() => validateBundles([bundle({ entry: { merkle: 'nope.ts' } })], root)).toThrow(
      /bundle "merkle" entry "nope.ts" does not exist/,
    );
  });

  it('rejects an empty entry list or map', () => {
    expect(() => validateBundles([bundle({ entry: [] })], sourceRoot())).toThrow(
      /bundle has an empty entry list/,
    );
    expect(() => validateBundles([bundle({ entry: {} })], sourceRoot())).toThrow(
      /bundle has an empty entry map/,
    );
  });

  it('rejects a bundle with no entry at all', () => {
    expect(() => validateBundles([bundle({ entry: undefined })], sourceRoot())).toThrow(
      /bundle has no entry; set entry to a source file/,
    );
  });

  it('rejects a bundle with no format', () => {
    expect(() => validateBundles([bundle({ format: [] })], sourceRoot())).toThrow(
      'bundle "index.ts" has no format; tsup would emit no output',
    );
  });

  it('rejects a format listed twice', () => {
    expect(() => validateBundles([bundle({ format: ['esm', 'esm'] })], sourceRoot())).toThrow(
      /lists a format twice \(esm, esm\); tsup emits duplicate files/,
    );
  });

  it('rejects two bundles that would write the same output file', () => {
    // Both default to dist, so a second bundle for the same source name would
    // silently overwrite the first instead of failing the build.
    const root = sourceRoot(['index.ts']);
    expect(() => validateBundles([bundle(), bundle()], root)).toThrow(
      /both emit "dist\/index"; give one of them a different output name/,
    );
  });

  it('allows the same output name in a different directory', () => {
    const root = sourceRoot(['index.ts']);
    expect(validateBundles([bundle(), bundle({ outDir: 'dist-esm' })], root)).toHaveLength(2);
  });

  it('rejects a second bundle that would clean away the first', () => {
    // `clean` empties the output directory, so two of them means the files built
    // by the first bundle are deleted while the second one runs.
    const root = sourceRoot(['index.ts', 'merkle.ts']);
    const configs = [
      bundle({ clean: true }),
      bundle({ entry: { merkle: 'merkle.ts' }, clean: true }),
    ];
    expect(() => validateBundles(configs, root)).toThrow(TsupConfigError);
    expect(() => validateBundles(configs, root)).toThrow(
      /bundle "merkle" sets clean, but bundle "index.ts" already cleans the output directory/,
    );
  });

  it('accepts the shipped config', () => {
    expect(validateBundles(bundles, sourceRoot())).toEqual(bundles);
  });
});

describe('resolveBundles', () => {
  it('validates and reports the plan', () => {
    const lines = describeBuildPlan(bundles);
    const validated = resolveBundles(bundles, sourceRoot());
    expect(validated).toEqual(bundles);
    expect(describeBuildPlan(validated)).toEqual(lines);
  });

  it('propagates a validation failure rather than building anyway', () => {
    expect(() =>
      resolveBundles([bundle({ entry: ['gone.ts'] })], sourceRoot(['index.ts'])),
    ).toThrow(TsupConfigError);
  });
});

describe('TsupConfigError', () => {
  it('is identifiable in a catch block', () => {
    const error = new TsupConfigError('boom');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TsupConfigError');
    expect(error.message).toBe('boom');
  });
});
