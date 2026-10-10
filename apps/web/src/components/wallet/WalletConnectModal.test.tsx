// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletConnectModal } from './WalletConnectModal';

const mocks = vi.hoisted(() => {
  const freighter = {
    name: 'Freighter',
    providerId: 'freighter',
    installUrl: 'https://freighter.app/',
    readStatus: vi.fn(),
    connect: vi.fn(),
  };
  const xbull = {
    name: 'xBull',
    providerId: 'xbull',
    installUrl: 'https://www.xbull.app/',
    readStatus: vi.fn(),
    connect: vi.fn(),
  };
  const hana = {
    name: 'Hana',
    providerId: 'hana',
    installUrl: 'https://hanawallet.io/',
    readStatus: vi.fn(),
    connect: vi.fn(),
  };
  return {
    freighter,
    xbull,
    hana,
    getWalletAdapters: vi.fn(() => [freighter, xbull, hana]),
  };
});

vi.mock('@/lib/wallet', () => ({
  getWalletAdapters: mocks.getWalletAdapters,
  LAST_WALLET_PROVIDER_KEY: 'accensa:last-wallet-provider',
}));

describe('WalletConnectModal', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.getWalletAdapters.mockReturnValue([mocks.freighter, mocks.xbull, mocks.hana]);
    mocks.freighter.readStatus.mockResolvedValue({ kind: 'disconnected' });
    mocks.xbull.readStatus.mockResolvedValue({ kind: 'unavailable' });
    mocks.hana.readStatus.mockResolvedValue({ kind: 'disconnected' });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value() {
        this.setAttribute('open', '');
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value() {
        this.removeAttribute('open');
      },
    });
  });

  it('shows installed state and warns when the connected wallet uses another network', async () => {
    mocks.freighter.readStatus.mockResolvedValue({
      kind: 'connected',
      address: 'GADDRESS',
      network: 'PUBLIC',
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
    });
    render(<WalletConnectModal open onOpenChange={vi.fn()} />);

    expect(await screen.findByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(await screen.findByText(/connected to PUBLIC/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/configured for testnet/i);
    expect(screen.getAllByRole('link', { name: 'Install' })).toHaveLength(1);
  });

  it('connects the selected provider, persists it, and closes on a matching network', async () => {
    const connected = {
      kind: 'connected' as const,
      address: 'GADDRESS',
      network: 'TESTNET',
      networkPassphrase: 'Test SDF Network ; September 2015',
    };
    mocks.freighter.connect.mockResolvedValue(connected);
    const onOpenChange = vi.fn();
    const onConnected = vi.fn();
    render(<WalletConnectModal open onOpenChange={onOpenChange} onConnected={onConnected} />);

    const freighterRow = screen.getByText('Freighter').parentElement?.parentElement;
    const connectButton = within(freighterRow as HTMLElement).getByRole('button', {
      name: 'Connect',
    });
    await waitFor(() => expect(connectButton).toBeEnabled());
    fireEvent.click(connectButton);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onConnected).toHaveBeenCalledWith({ provider: 'Freighter', address: 'GADDRESS' });
    expect(localStorage.getItem('accensa:last-wallet-provider')).toBe('freighter');
  });

  it('restores the last provider status when the modal owner mounts', async () => {
    localStorage.setItem('accensa:last-wallet-provider', 'hana');
    mocks.hana.readStatus.mockResolvedValue({
      kind: 'connected',
      address: 'GHANA',
      network: 'TESTNET',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    const onConnected = vi.fn();
    render(<WalletConnectModal open={false} onOpenChange={vi.fn()} onConnected={onConnected} />);

    await waitFor(() =>
      expect(onConnected).toHaveBeenCalledWith({ provider: 'Hana', address: 'GHANA' }),
    );
  });
});
