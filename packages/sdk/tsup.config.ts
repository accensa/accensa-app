import { defineConfig, type Options } from 'tsup';

/**
 * Shared build options for every entry in this package.
 *
 * Extracted so an optimization lands in exactly one place: `treeshake`
 * drops unused exports for ESM consumers and `minify` shrinks the shipped
 * bundles, so the published package parses and loads faster while keeping
 * the emitted output functionally identical.
 *
 * Build-time metric (see `scripts/measure-build.mjs`): measured on the same
 * inputs with the optimizations off vs on — smaller dist bytes and faster
 * builds on every run (numbers printed by the script).
 */
const baseOptions: Options = {
  format: ['esm', 'cjs'],
  dts: true,
  outDir: 'dist',
  splitting: false,
  sourcemap: false,
  target: 'node18',
  treeshake: true,
  minify: true,
};

export default defineConfig([
  {
    ...baseOptions,
    entry: ['index.ts'],
    // The SDK entry is rebuilt from scratch each time so a stale dist can never
    // mask a removal; the banner tags the emitted bundle with its provenance.
    clean: true,
    banner: {
      js: '// @accensa/sdk — https://github.com/accensa/accensa-app',
    },
  },
  {
    ...baseOptions,
    // `merkle` ships as its own subpath export (`@accensa/sdk/merkle`) so a
    // consumer that only does receipt-tree reads never pulls in the rest of
    // the SDK. Kept as a separate entry rather than added to the index so
    // `splitting: false` cannot merge it into the main bundle.
    entry: { merkle: 'merkle.ts' },
  },
]);
