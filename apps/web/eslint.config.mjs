import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Playwright output — generated per run, never source.
    'test-results/**',
    'playwright-report/**',
    // Build artifacts (e.g. packages/sdk/dist). CI lints before building, but a
    // locally built tree must lint the same way — emitted JS is not source.
    '**/dist/**',
  ]),
]);

export default eslintConfig;
