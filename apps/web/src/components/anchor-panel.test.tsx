// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/freighter', () => ({
  readStatus: vi.fn(async () => ({ kind: 'connected' })),
  connect: vi.fn(async () => ({ kind: 'connected' })),
  FREIGHTER_INSTALL_URL: 'https://freighter.app',
}));
vi.mock('@/lib/anchor-submit', () => ({
  submitAnchor: vi.fn(),
}));

import { submitAnchor } from '@/lib/anchor-submit';
import { AnchorPanel } from './anchor-panel';

type Existing = { batchId: number; status: 'submitted' | 'recorded'; anchorTx: string | null };

function preview(existing: Existing | null = null) {
  return {
    selectionHash: 'sel',
    root: 'ab'.repeat(32),
    count: 2,
    periodStart: 1_700_000_000,
    periodEnd: 1_700_003_600,
    startLedger: 10,
    endLedger: 20,
    payments: [],
    existing,
    merchant: 'GMERCHANT',
    contractId: 'CCONTRACT',
    networkPassphrase: 'Test SDF Network ; September 2015',
    maxBatchSize: 256,
  };
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body } as Response;
}

/** Routes preview and record requests to the given responses. */
function stubFetch(previewBody: unknown, recordResponse: Response = jsonResponse({ ok: true })) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const u = url.toString();
    if (u.includes('/api/anchor/preview')) return jsonResponse(previewBody);
    if (u.includes('/api/anchor/record')) return recordResponse;
    throw new Error(`unexpected fetch ${u}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function recordCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => url.toString().includes('/api/anchor/record'));
}

describe('AnchorPanel', () => {
  beforeEach(() => {
    vi.mocked(submitAnchor).mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts idle and moves to the preview phase once the preview loads', async () => {
    stubFetch(preview());
    render(<AnchorPanel />);

    expect(screen.getByRole('heading', { name: 'Anchor a batch' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /preview unanchored/i }));

    expect(await screen.findByRole('button', { name: 'Sign and submit' })).toBeInTheDocument();
    expect(screen.getByText('ab'.repeat(32))).toBeInTheDocument();
  });

  it('shows the empty phase when nothing is unanchored', async () => {
    stubFetch({ count: 0, merchant: 'GMERCHANT' });
    render(<AnchorPanel />);
    fireEvent.click(screen.getByRole('button', { name: /preview unanchored/i }));

    expect(await screen.findByText(/nothing unanchored/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check again/i })).toBeInTheDocument();
  });

  it('returns to idle with the server error when the preview fails', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'indexer offline' }, false));
    vi.stubGlobal('fetch', fetchMock);
    render(<AnchorPanel />);
    fireEvent.click(screen.getByRole('button', { name: /preview unanchored/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('indexer offline');
    expect(screen.getByRole('button', { name: /preview unanchored/i })).toBeInTheDocument();
  });

  it('finishes recording a submitted batch without signing again', async () => {
    const fetchMock = stubFetch(preview({ batchId: 123, status: 'submitted', anchorTx: 'tx123' }));
    render(<AnchorPanel />);
    fireEvent.click(screen.getByRole('button', { name: /preview unanchored/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Finish recording' }));

    expect(await screen.findByText(/Batch #123 recorded/)).toBeInTheDocument();
    expect(submitAnchor).not.toHaveBeenCalled();
    const calls = recordCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(JSON.parse((calls[0][1] as RequestInit).body as string)).toMatchObject({
      batchId: 123,
      anchorTx: 'tx123',
    });
  });

  it('treats an already recorded selection as done without any request', async () => {
    const fetchMock = stubFetch(preview({ batchId: 7, status: 'recorded', anchorTx: 'tx7' }));
    render(<AnchorPanel />);
    fireEvent.click(screen.getByRole('button', { name: /preview unanchored/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Already anchored' }));

    expect(await screen.findByText(/Batch #7 recorded/)).toBeInTheDocument();
    expect(submitAnchor).not.toHaveBeenCalled();
    expect(recordCalls(fetchMock)).toHaveLength(0);
  });

  it('keeps the batch id in the recovery message when recording fails', async () => {
    stubFetch(
      preview({ batchId: 456, status: 'submitted', anchorTx: 'tx456' }),
      jsonResponse({}, false, 503),
    );
    render(<AnchorPanel />);
    fireEvent.click(screen.getByRole('button', { name: /preview unanchored/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Finish recording' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Recording failed (503). The batch is on-chain as #456; retry recording without submitting again.',
      ),
    );
    // Back in the preview phase so the merchant can retry the recording.
    expect(screen.getByRole('button', { name: 'Finish recording' })).toBeEnabled();
    expect(submitAnchor).not.toHaveBeenCalled();
  });

  it('signs and records a fresh selection exactly once', async () => {
    vi.mocked(submitAnchor).mockResolvedValue({ status: 'confirmed', batchId: 9, hash: 'txfresh' });
    const fetchMock = stubFetch(preview());
    render(<AnchorPanel />);
    fireEvent.click(screen.getByRole('button', { name: /preview unanchored/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign and submit' }));

    expect(await screen.findByText(/Batch #9 recorded/)).toBeInTheDocument();
    expect(submitAnchor).toHaveBeenCalledTimes(1);
    expect(recordCalls(fetchMock)).toHaveLength(1);
  });
});
