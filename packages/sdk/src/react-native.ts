/**
 * Bridgeless Architecture for React Native Compatibility (#166).
 *
 * Provides a platform-agnostic SDK adapter that works without native bridges.
 * Uses fetch API (available in React Native's JavaScriptCore) instead of
 * native HTTP modules, making the SDK work in Expo managed workflow and
 * other bridgeless environments.
 *
 * Usage:
 *   import { createAccensaClient } from '@accensa/sdk/react-native';
 *
 *   const client = createAccensaClient({
 *     indexerUrl: 'https://your-indexer.vercel.app',
 *     headers: { 'Authorization': 'Bearer ...' },
 *   });
 */

import { AccensaClient, AccensaClientOptions } from './client';

export interface ReactNativeClientOptions extends Omit<AccensaClientOptions, 'fetchImpl'> {
  /** Custom fetch implementation (e.g., from expo-fetch or undici). */
  customFetch?: typeof fetch;
}

/**
 * Create an Accensa client optimized for React Native / bridgeless environments.
 *
 * - Uses globalThis.fetch (available in RN's JS engine)
 * - No native module dependencies
 * - Works with Expo managed workflow
 * - Supports custom fetch implementations for advanced use cases
 */
export function createAccensaClient(opts: ReactNativeClientOptions): AccensaClient {
  // React Native's JavaScriptCore provides fetch globally
  const fetchImpl = opts.customFetch ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error(
      'No fetch implementation available. In React Native, ensure you are ' +
        'running in a JavaScript engine that provides fetch (JSC/Hermes). ' +
        'Or pass a customFetch option.',
    );
  }

  return new AccensaClient({
    indexerUrl: opts.indexerUrl,
    headers: opts.headers,
    timeoutMs: opts.timeoutMs,
    fetchImpl,
  });
}

/**
 * SSR-safe client factory for Next.js + React Native Web.
 * Returns null on server side, client on browser/React Native.
 */
export function createUniversalClient(opts: ReactNativeClientOptions): AccensaClient | null {
  if (typeof globalThis.document === 'undefined' && typeof globalThis.navigator === 'undefined') {
    // Server-side or Node.js — return null, use server-side rendering
    return null;
  }
  return createAccensaClient(opts);
}
