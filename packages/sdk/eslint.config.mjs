import sharedConfig from '../../apps/web/eslint.config.mjs';

export default [
  ...sharedConfig,
  // `dist/` is build output (gitignored at the repo root); a flat-config object
  // with only `ignores` is global-ignores. Linting the bundled files reports
  // `require()` imports from the CJS build and minified-expression noise that
  // has nothing to do with the sources.
  { ignores: ['dist/**'] },
];
