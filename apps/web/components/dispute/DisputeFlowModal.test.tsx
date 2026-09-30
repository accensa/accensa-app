// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DisputeFlowModal, DisputeReason } from './DisputeFlowModal';

describe('DisputeFlowModal', () => {
  const mockProps = {
    isOpen: true,
    onClose: vi.fn(),
    transactionHash: 'a'.repeat(64),
    transactionAmount: '100.0000000',
    assetSymbol: 'XLM',
    onSubmitDispute: vi.fn().mockResolvedValue(undefined),
  };

  it('renders modal when open', () => {
    render(<DisputeFlowModal {...mockProps} />);
    expect(screen.getByText('Request Refund')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<DisputeFlowModal {...mockProps} isOpen={false} />);
    expect(screen.queryByText('Request Refund')).not.toBeInTheDocument();
  });

  it('displays step 1 (selection) by default', () => {
    render(<DisputeFlowModal {...mockProps} />);
    // The stepper shows every step's label; the active step also renders an
    // <h3> heading. Scope the query to the heading.
    expect(screen.getByText('Select Refund Amount', { selector: 'h3' })).toBeInTheDocument();
  });

  it('allows navigation between steps', async () => {
    render(<DisputeFlowModal {...mockProps} />);

    // Step 1: Select full refund
    fireEvent.click(screen.getByRole('button', { name: /Full Refund/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(screen.getByText('Select Dispute Reason', { selector: 'h3' })).toBeInTheDocument();
    });

    // Step 2: Select reason
    fireEvent.click(screen.getByRole('button', { name: /Item Not Received/ }));

    const descriptionInput = screen.getByPlaceholderText(
      'Please provide details about your issue...',
    );
    fireEvent.change(descriptionInput, { target: { value: 'Item never arrived' } });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(screen.getByText('Review & Confirm', { selector: 'h3' })).toBeInTheDocument();
    });
  });

  it('validates refund amount', () => {
    render(<DisputeFlowModal {...mockProps} />);

    const customInput = screen.getByPlaceholderText('Enter amount');
    fireEvent.change(customInput, { target: { value: '200' } }); // Exceeds transaction amount

    expect(screen.getByText(/Refund amount cannot exceed/)).toBeInTheDocument();
    // And the over-amount entry must not be submittable.
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('validates description length', async () => {
    render(<DisputeFlowModal {...mockProps} />);

    // Navigate to step 2
    fireEvent.click(screen.getByRole('button', { name: /Full Refund/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(screen.getByText('Select Dispute Reason', { selector: 'h3' })).toBeInTheDocument();
    });

    // Select reason but enter short description
    fireEvent.click(screen.getByRole('button', { name: /Item Not Received/ }));
    const descriptionInput = screen.getByPlaceholderText(
      'Please provide details about your issue...',
    );
    fireEvent.change(descriptionInput, { target: { value: 'Short' } });

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('submits dispute on confirmation', async () => {
    render(<DisputeFlowModal {...mockProps} />);

    // Complete all steps
    fireEvent.click(screen.getByRole('button', { name: /Full Refund/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(screen.getByText('Select Dispute Reason', { selector: 'h3' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Item Not Received/ }));
    const descriptionInput = screen.getByPlaceholderText(
      'Please provide details about your issue...',
    );
    fireEvent.change(descriptionInput, { target: { value: 'Item never arrived after payment' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(screen.getByText('Review & Confirm', { selector: 'h3' })).toBeInTheDocument();
    });

    // Confirm checkbox
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    const submitButton = screen.getByRole('button', { name: 'Submit Dispute' });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockProps.onSubmitDispute).toHaveBeenCalledWith(
        expect.objectContaining({
          txHash: mockProps.transactionHash,
          refundAmount: mockProps.transactionAmount,
          reason: DisputeReason.NON_DELIVERY,
        }),
      );
    });
  });

  it('closes modal on close button click', () => {
    render(<DisputeFlowModal {...mockProps} />);

    // The only other buttons at step 1 are "Full Refund" and "Next"; the
    // close button has no text, so fall back to matching by absent name.
    const closeButton = screen.getByRole('button', { name: '' });
    fireEvent.click(closeButton);

    expect(mockProps.onClose).toHaveBeenCalled();
  });

  it('shows stepper progress indicator', () => {
    render(<DisputeFlowModal {...mockProps} />);

    // The stepper labels and the current step's <h3> heading share text;
    // scope the assertion to the stepper's small-print spans.
    expect(screen.getByText('Select Refund Amount', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Dispute Reason', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Review & Confirm', { selector: 'span' })).toBeInTheDocument();
  });
});
