// jest-dom v7's default entry extends the *global* `expect`; this suite does
// not enable vitest globals, so use the dedicated vitest entry, which wires
// the matchers into vitest's own `expect`.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Testing Library registers its auto-cleanup on a global `afterEach`, which
// does not exist in globals-off mode. Without this, rendered DOM leaks across
// tests and `screen` queries match stale elements from earlier renders.
afterEach(cleanup);
