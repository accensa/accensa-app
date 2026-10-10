/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpressCheckoutButton } from './ExpressCheckoutButton';

const { mockGetSessionKey, mockPlaySound } = vi.hoisted(() => ({
  mockGetSessionKey: vi.fn().mockResolvedValue('private-key'),
  mockPlaySound: vi.fn(),
}));

vi.mock('@accensa/sdk/session/express', () => ({
  canSpendExpress: () => true,
  getExpressSessionKey: mockGetSessionKey,
}));
vi.mock('@/lib/audio/soundEffects', () => ({ playSoundEffect: mockPlaySound }));
vi.mock('@/components/common/SoundToggle', () => ({
  SoundToggle: () => <button>Sound toggle</button>,
}));

const props = {
  sessionId: 'session-1',
  amount: '10',
  allowance: {} as never,
};

describe('ExpressCheckoutButton audio cues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockGetSessionKey.mockResolvedValue('private-key');
  });

  it('plays cues without changing successful authorization behavior', async () => {
    const onAuthorize = vi.fn().mockResolvedValue({ receiptId: 'receipt-1' });
    render(<ExpressCheckoutButton {...props} onAuthorize={onAuthorize} />);
    const button = await screen.findByRole('button', { name: '1-Click Pay with Accensa' });

    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText(/Payment authorized/)).toBeInTheDocument());
    expect(onAuthorize).toHaveBeenCalledWith({ privateKey: 'private-key', amount: '10' });
    expect(mockPlaySound.mock.calls.map(([cue]) => cue)).toEqual(['click', 'success']);
  });

  it('plays an error cue without swallowing the existing failure state', async () => {
    const onAuthorize = vi.fn().mockRejectedValue(new Error('declined'));
    render(<ExpressCheckoutButton {...props} onAuthorize={onAuthorize} />);
    const button = await screen.findByRole('button', { name: '1-Click Pay with Accensa' });

    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Authorization failed/),
    );
    expect(mockPlaySound.mock.calls.map(([cue]) => cue)).toEqual(['click', 'error']);
  });

  it('does not authorize payment when the inventory reservation fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'out_of_stock' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onAuthorize = vi.fn();
    render(
      <ExpressCheckoutButton
        {...props}
        inventory={{ merchantId: 1, items: [{ sku: 'sku-1', quantity: 1 }] }}
        onAuthorize={onAuthorize}
      />,
    );
    const button = await screen.findByRole('button', { name: '1-Click Pay with Accensa' });

    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Authorization failed/),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/inventory/reservations',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(onAuthorize).not.toHaveBeenCalled();
  });
});
