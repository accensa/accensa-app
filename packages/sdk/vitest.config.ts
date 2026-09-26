import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * `tsc` now runs alongside the suite, which starves the event loop enough
     * on a loaded machine to push the timer-driven tests (the abort and retry
     * cases in `index.test.ts`) past Vitest's 5s default and fail them for
     * having nothing to do with the change under test. The suite is ~400 tests
     * and finishes in seconds either way, so the headroom is cheap.
     */
    testTimeout: 15_000,
    typecheck: {
      /**
       * `generated/api-types.ts` is types all the way down, so its tests are
       * type tests: `src/api/api-types.test-d.ts` asserts that the hand-written
       * layer over the generated file still has the spec's key sets, and that
       * the SDK's wire types are the spec's rather than copies of them. Those
       * assertions only fail under `tsc`, so Vitest's typecheck mode is what
       * makes them part of `pnpm test` (and therefore of CI) rather than a
       * file nobody runs.
       *
       * The runtime half of the same coverage is `api-types.test.ts`.
       */
      enabled: true,
      include: ['**/*.test-d.ts'],
    },
  },
});
