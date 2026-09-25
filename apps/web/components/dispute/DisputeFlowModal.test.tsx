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
    expect(screen.getByText('Select Refund Amount')).toBeInTheDocument();
  });

  it('allows navigation between steps', async () => {
    render(<DisputeFlowModal {...mockProps} />);

    // Step 1: Select full refund
    const fullRefundButton = screen.getByText('Full Refund');
    fireEvent.click(fullRefundButton);

    const nextButton = screen.getByText('Next');
    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(screen.getByText('Select Dispute Reason')).toBeInTheDocument();
    });

    // Step 2: Select reason
    const reasonButton = screen.getByText('Item Not Received');
    fireEvent.click(reasonButton);

    const descriptionInput = screen.getByPlaceholderText('Please provide details about your issue...');
    fireEvent.change(descriptionInput, { target: { value: 'Item never arrived' } });

    const nextButton2 = screen.getAllByText('Next')[1];
    fireEvent.click(nextButton2);

    await waitFor(() => {
      expect(screen.getByText('Review & Confirm')).toBeInTheDocument();
    });
  });

  it('validates refund amount', () => {
    render(<DisputeFlowModal {...mockProps} />);

    const customInput = screen.getByPlaceholderText('Enter amount');
    fireEvent.change(customInput, { target: { value: '200' } }); // Exceeds transaction amount

    expect(screen.getByText(/Refund amount cannot exceed/)).toBeInTheDocument();
  });

  it('validates description length', async () => {
    render(<DisputeFlowModal {...mockProps} />);

    // Navigate to step 2
    fireEvent.click(screen.getByText('Full Refund'));
    fireEvent.click(screen.getByText('Next'));

    await waitFor(() => {
      expect(screen.getByText('Select Dispute Reason')).toBeInTheDocument();
    });

    // Select reason but enter short description
    fireEvent.click(screen.getByText('Item Not Received'));
    const descriptionInput = screen.getByPlaceholderText('Please provide details about your issue...');
    fireEvent.change(descriptionInput, { target: { value: 'Short' } });

    const nextButton = screen.getAllByText('Next')[1];
    expect(nextButton).toBeDisabled();
  });

  it('submits dispute on confirmation', async () => {
    render(<DisputeFlowModal {...mockProps} />);

    // Complete all steps
    fireEvent.click(screen.getByText('Full Refund'));
    fireEvent.click(screen.getByText('Next'));

    await waitFor(() => {
      expect(screen.getByText('Select Dispute Reason')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Item Not Received'));
    const descriptionInput = screen.getByPlaceholderText('Please provide details about your issue...');
    fireEvent.change(descriptionInput, { target: { value: 'Item never arrived after payment' } });
    fireEvent.click(screen.getAllByText('Next')[1]);

    await waitFor(() => {
      expect(screen.getByText('Review & Confirm')).toBeInTheDocument();
    });

    // Confirm checkbox
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    const submitButton = screen.getByText('Submit Dispute');
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockProps.onSubmitDispute).toHaveBeenCalledWith(
        expect.objectContaining({
          txHash: mockProps.transactionHash,
          refundAmount: mockProps.transactionAmount,
          reason: DisputeReason.NON_DELIVERY,
        })
      );
    });
  });

  it('closes modal on close button click', () => {
    render(<DisputeFlowModal {...mockProps} />);

    const closeButton = screen.getByRole('button', { name: '' }); // X button
    fireEvent.click(closeButton);

    expect(mockProps.onClose).toHaveBeenCalled();
  });

  it('shows stepper progress indicator', () => {
    render(<DisputeFlowModal {...mockProps} />);

    expect(screen.getByText('Select Refund Amount')).toBeInTheDocument();
    expect(screen.getByText('Dispute Reason')).toBeInTheDocument();
    expect(screen.getByText('Review & Confirm')).toBeInTheDocument();
  });
});
