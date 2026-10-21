// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import Landing from './page';

// Mock ScrollReveal as a simple pass-through to avoid IntersectionObserver setup in jsdom
vi.mock('@/components/scroll-reveal', () => ({
  ScrollReveal: ({
    children,
    className = '',
    as: Component = 'section',
  }: {
    children: React.ReactNode;
    className?: string;
    as?: React.ElementType;
  }) => <Component className={className}>{children}</Component>,
}));

describe('Landing page vault contract section (#625)', () => {
  const originalEnv = process.env.NEXT_PUBLIC_REFUND_VAULT_ID;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_REFUND_VAULT_ID;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_REFUND_VAULT_ID;
    } else {
      process.env.NEXT_PUBLIC_REFUND_VAULT_ID = originalEnv;
    }
  });

  it('renders vault section without link and without contract id when NEXT_PUBLIC_REFUND_VAULT_ID is unset', () => {
    delete process.env.NEXT_PUBLIC_REFUND_VAULT_ID;

    render(<Landing />);

    const vaultCard = screen.getByTestId('contract-card-refundvault');
    expect(vaultCard).toBeInTheDocument();

    // Verify it is NOT a link (no <a> tag, no href attribute)
    expect(vaultCard.tagName).toBe('DIV');
    expect(vaultCard.closest('a')).toBeNull();
    expect(vaultCard).not.toHaveAttribute('href');

    // Verify no contract ID (neither the old hardcoded CCMB nor any contract ID) appears in the vault card markup
    expect(vaultCard.textContent).toBe('RefundVault');
    expect(vaultCard.innerHTML).not.toContain(
      'CCMBM44EJUGD52G4LSMGHSXMAH2KSAQZX7VOYY4TTBF5BK4D7M4IHRQA',
    );

    // ReceiptAnchor should still have its link and contract ID
    const receiptCard = screen.getByTestId('contract-card-receiptanchor');
    expect(receiptCard.tagName).toBe('A');
    expect(receiptCard).toHaveAttribute('href');
  });

  it('renders vault section with explorer link and matching contract id when configured', () => {
    const customVaultId = 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR';
    process.env.NEXT_PUBLIC_REFUND_VAULT_ID = customVaultId;

    render(<Landing />);

    const vaultCard = screen.getByTestId('contract-card-refundvault');
    expect(vaultCard).toBeInTheDocument();

    // Verify it is a link pointing to the explorer contract URL with the custom ID
    expect(vaultCard.tagName).toBe('A');
    expect(vaultCard).toHaveAttribute('href', expect.stringContaining(customVaultId));
    expect(vaultCard).toHaveAttribute('target', '_blank');

    // Verify the contract ID is present in the markup
    expect(vaultCard.textContent).toContain(customVaultId);
  });
});
