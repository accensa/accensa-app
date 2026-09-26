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
  // Output both ECMAScript modules (ESM) and CommonJS (CJS) formats for broad compatibility.
  format: ['esm', 'cjs'],
  // Generate TypeScript declaration files (.d.ts) to provide types for consumers.
  dts: true,
  // The output directory where compiled files will be saved.
  outDir: 'dist',
  // Disable code splitting to ensure single predictable output files.
  splitting: false,
  // Disable sourcemaps to keep the package size minimal in production.
  sourcemap: false,
  // Target Node.js 18 environment for compatibility with the project's runtime requirements.
  target: 'node18',
  // Enable tree-shaking to eliminate dead code and reduce bundle size.
  treeshake: true,
  // Minify the output code for smaller file size.
  minify: true,
};

/**
 * Main tsup configuration defining the multiple entry points of the SDK package.
 * We build separate entry points (e.g. index and merkle) to allow consumers
 * to import only what they need without pulling in unused dependencies.
 */
export default defineConfig([
  {
    ...baseOptions,
    // The main entry point for the SDK, exposing core functionality.
    entry: ['index.ts'],
    // Clean the dist folder before building to avoid stale artifacts.
    clean: true,
    // Inject a banner at the top of generated JavaScript files for attribution.
    banner: {
      js: '// @accensa/sdk — https://github.com/accensa/accensa-app',
    },
  },
  {
    ...baseOptions,
    // A secondary entry point specifically for merkle tree functionality.
    entry: { merkle: 'merkle.ts' },
  },
]);
