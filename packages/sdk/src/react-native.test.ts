import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccensaClient } from './client';
import { createAccensaClient, createUniversalClient } from './react-native';

const OPTIONS = { indexerUrl: 'https://indexer.example.com' };

describe('createAccensaClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('falls back to globalThis.fetch', () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);

    const client = createAccensaClient(OPTIONS);

    expect(client).toBeInstanceOf(AccensaClient);
  });

  it('uses a supplied customFetch implementation', () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', vi.fn());

    const client = createAccensaClient({ ...OPTIONS, customFetch: fetchImpl });

    expect(client).toBeInstanceOf(AccensaClient);
  });

  it('throws when no fetch implementation is available', () => {
    vi.stubGlobal('fetch', undefined);

    expect(() => createAccensaClient(OPTIONS)).toThrow(/fetch/i);
  });

  it('still works when customFetch is provided and globalThis.fetch is missing', () => {
    vi.stubGlobal('fetch', undefined);

    const client = createAccensaClient({ ...OPTIONS, customFetch: vi.fn() });

    expect(client).toBeInstanceOf(AccensaClient);
  });
});

describe('createUniversalClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns null in an SSR environment without document and navigator', () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('fetch', vi.fn());

    expect(createUniversalClient(OPTIONS)).toBeNull();
  });

  it('creates a client when DOM globals are present', () => {
    vi.stubGlobal('document', {});
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', vi.fn());

    expect(createUniversalClient(OPTIONS)).toBeInstanceOf(AccensaClient);
  });
});
