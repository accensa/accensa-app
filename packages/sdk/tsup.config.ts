import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist',
    clean: true,
    splitting: false,
    sourcemap: false,
    target: 'node18',
    banner: {
      js: '// @accensa/sdk — https://github.com/accensa/accensa-app',
    },
  },
  {
    entry: { merkle: 'merkle.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist',
    splitting: false,
    sourcemap: false,
    target: 'node18',
  },
]);
