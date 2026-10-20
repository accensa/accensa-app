// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocialShareButtons } from './SocialShareButtons';

const txHash = 'a1b2c3d4e5f60708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

describe('SocialShareButtons', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the checking state and no links while the anchoring check is pending', () => {
    vi.spyOn(global, 'fetch').mockReturnValue(new Promise(() => {}));

    render(<SocialShareButtons txHash={txHash} amount="10" asset="XLM" />);

    expect(screen.getByText('Checking receipt availability…')).toBeDefined();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the not-yet-available message when the check resolves false', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false } as Response);

    render(<SocialShareButtons txHash={txHash} amount="10" asset="XLM" />);

    await waitFor(() =>
      expect(
        screen.getByText('Social sharing is available after the receipt is anchored.'),
      ).toBeDefined(),
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders share links with URL-encoded txHash when the check resolves true', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    render(<SocialShareButtons txHash={txHash} amount="10" asset="XLM" />);

    await waitFor(() => expect(screen.getByText('Share to X')).toBeDefined());

    const encoded = encodeURIComponent(txHash);
    for (const name of ['Share to X', 'Share to Warpcast', 'Share to Bluesky']) {
      const href = screen.getByRole('link', { name }).getAttribute('href')!;
      expect(href).toContain(encoded);
    }
  });

  it('aborts the anchoring fetch when unmounted before it resolves', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      capturedSignal = (init as RequestInit)?.signal as AbortSignal;
      return new Promise(() => {});
    });

    const { unmount } = render(<SocialShareButtons txHash={txHash} amount="10" asset="XLM" />);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });
});
