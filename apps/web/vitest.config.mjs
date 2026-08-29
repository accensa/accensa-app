import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    env: {
      // Give the suite a defined Stellar network so explorer-link helpers do not
      // fall back (and warn) on every render. Tests that exercise the unset and
      // invalid cases pass the value explicitly.
      NEXT_PUBLIC_STELLAR_NETWORK: 'testnet',
    },
  },
});
