import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Options } from 'tsup';

/**
 * Raised when this config is internally inconsistent, or points at a source file
 * that is not there.
 *
 * tsup treats a bad config as a generic build failure, and the message it prints
 * for a missing entry is about module resolution deep inside esbuild. Naming the
 * bundle and the fix here is the difference between a one-line fix and a hunt.
 */
export class TsupConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TsupConfigError';
  }
}

/**
 * Directory the entries are resolved against.
 *
 * tsup resolves relative entries against the working directory, and `pnpm`
 * runs `build` from the package directory (`pnpm --filter @accensa/sdk build`
 * and `prepack` both do), so this mirrors how tsup itself finds the entries.
 * Reading the config's own directory instead is not an option: tsup bundles
 * this file before loading it, so its location is not the package's.
 */
export function packageRoot(): string {
  return process.cwd();
}

/**
 * Options both bundles share.
 *
 * Kept in one place so the two published bundles cannot drift: `dist/merkle.*`
 * is resolved by consumers that never load the main entry, and a format or
 * target added to one bundle only would go unnoticed until something imported
 * it.
 */
export const baseOptions: Options = {
  format: ['esm', 'cjs'],
  dts: true,
  outDir: 'dist',
  splitting: false,
  sourcemap: false,
  target: 'node18',
};

/** Banner linking each bundle back to the repository it was built from. */
export const BANNER = '// @accensa/sdk — https://github.com/accensa/accensa-app';

/** The published bundles: the package entry, and the standalone Merkle module. */
export const bundles: ReadonlyArray<Options> = [
  { ...baseOptions, entry: ['index.ts'], clean: true, banner: { js: BANNER } },
  { ...baseOptions, entry: { merkle: 'merkle.ts' } },
];

/** Formats of one bundle, normalised from tsup's `Format | Format[]`. */
function formatsOf(bundle: Options): string[] {
  const { format } = bundle;
  if (format === undefined) return [];
  return Array.isArray(format) ? format : [format];
}

/** Entry sources of one bundle, as `[outputName, sourceFile]` pairs. */
function entrySources(bundle: Options, label: string): Array<[string, string]> {
  const { entry } = bundle;
  if (Array.isArray(entry)) {
    if (entry.length === 0) {
      throw new TsupConfigError(`${label} has an empty entry list; name at least one source file`);
    }
    return entry.map((file) => [file.replace(/\.[^./]+$/, ''), file]);
  }
  if (entry && typeof entry === 'object') {
    const pairs = Object.entries(entry);
    if (pairs.length === 0) {
      throw new TsupConfigError(`${label} has an empty entry map; name at least one source file`);
    }
    return pairs;
  }
  throw new TsupConfigError(
    `${label} has no entry; set entry to a source file, a list, or an output-name map`,
  );
}

/** Label for messages, derived from the bundle's outputs rather than its position. */
function labelOf(bundle: Options): string {
  const names = Array.isArray(bundle.entry)
    ? bundle.entry
    : bundle.entry && typeof bundle.entry === 'object'
      ? Object.keys(bundle.entry)
      : [];
  return names.length > 0 ? `bundle "${names.join(', ')}"` : 'bundle';
}

/**
 * Checks the bundle list before tsup runs, and returns it unchanged.
 *
 * The checks are the failure modes this config can actually have, not a schema:
 * a renamed source file, a bundle that would silently overwrite another's
 * output, and a second `clean` run that would delete the first bundle's files
 * because both build into `dist`.
 *
 * @throws {TsupConfigError} on the first problem found
 */
export function validateBundles(
  configs: ReadonlyArray<Options>,
  root: string = packageRoot(),
): Options[] {
  if (configs.length === 0) {
    throw new TsupConfigError('no bundles configured; the package would publish nothing');
  }

  const outputs = new Map<string, string>();
  let cleaner: string | undefined;

  for (const bundle of configs) {
    const label = labelOf(bundle);

    const formats = formatsOf(bundle);
    if (formats.length === 0) {
      throw new TsupConfigError(`${label} has no format; tsup would emit no output`);
    }
    if (new Set(formats).size !== formats.length) {
      throw new TsupConfigError(
        `${label} lists a format twice (${formats.join(', ')}); tsup emits duplicate files`,
      );
    }

    for (const [outputName, file] of entrySources(bundle, label)) {
      if (!existsSync(resolve(root, file))) {
        throw new TsupConfigError(
          `${label} entry "${file}" does not exist in ${root}; ` +
            'update the entry if the file was renamed or moved',
        );
      }

      // Two bundles writing the same name into the same directory would be a
      // silent last-writer-wins, not a build error.
      const key = join(bundle.outDir ?? 'dist', outputName);
      const previous = outputs.get(key);
      if (previous) {
        throw new TsupConfigError(
          `${label} and ${previous} both emit "${key}"; give one of them a different output name`,
        );
      }
      outputs.set(key, label);
    }

    if (bundle.clean) {
      // `clean` empties the output directory, so a second bundle enabling it
      // deletes the files the first one just wrote.
      if (cleaner) {
        throw new TsupConfigError(
          `${label} sets clean, but ${cleaner} already cleans the output directory; ` +
            'keep clean on one bundle so the others are not deleted as they are built',
        );
      }
      cleaner = label;
    }
  }

  return [...configs];
}

/** Human-readable summary of what will be built, one line per bundle. */
export function describeBuildPlan(configs: ReadonlyArray<Options>): string[] {
  return configs.map((bundle) => {
    const outs = Array.isArray(bundle.entry)
      ? bundle.entry
      : bundle.entry && typeof bundle.entry === 'object'
        ? Object.values(bundle.entry)
        : [];
    return `@accensa/sdk: ${outs.join(', ')} -> ${bundle.outDir ?? 'dist'} (${formatsOf(bundle).join(', ')})`;
  });
}

/**
 * Validates the bundles and reports the plan.
 *
 * Logging here — rather than after tsup finishes — means the resolved plan is
 * visible even when the build fails halfway.
 */
export function resolveBundles(
  configs: ReadonlyArray<Options> = bundles,
  root?: string,
): Options[] {
  const validated = validateBundles(configs, root);
  console.log(describeBuildPlan(validated).join('\n'));
  return validated;
}

export default defineConfig(resolveBundles());
