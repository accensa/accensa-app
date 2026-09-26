import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WalletConnectModal } from './WalletConnectModal';

describe('WalletConnectModal', () => {
  it('renders the accessible wallet choices and expected network', () => {
    const html = renderToString(
      <WalletConnectModal isOpen onClose={vi.fn()} onConnect={vi.fn(async () => undefined)} />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Freighter');
    expect(html).toContain('xBull');
    expect(html).toContain('Hana');
    expect(html).toContain('TESTNET');
    expect(html).toContain('Checking');
  });

  it('does not render while closed', () => {
    expect(
      renderToString(
        <WalletConnectModal isOpen={false} onClose={vi.fn()} onConnect={vi.fn(async () => undefined)} />,
      ),
    ).toBe('');
  });
});
