// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TotpSetupModal } from './TotpSetupModal';

const generateData = {
  secret: 'JBSWY3DPEHPK3PXP',
  qrCodeUrl: 'data:image/png;base64,mockQrCodeData',
  backupCodes: ['1111-2222', '3333-4444', '5555-6666', '7777-8888'],
};

describe('TotpSetupModal', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const defaultEmail = 'merchant@example.com';

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : '';
      if (url.includes('/api/auth/totp/generate')) {
        return new Response(JSON.stringify(generateData), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
  });

  it('renders nothing when closed', () => {
    const onClose = vi.fn();
    render(<TotpSetupModal isOpen={false} onClose={onClose} userEmail={defaultEmail} />);

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByText('Set up Two-Factor Authentication')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts at step 1 on open and requests the secret and QR code to populate the view', async () => {
    const onClose = vi.fn();
    render(<TotpSetupModal isOpen={true} onClose={onClose} userEmail={defaultEmail} />);

    expect(
      screen.getByRole('heading', { name: 'Set up Two-Factor Authentication' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/totp/generate', { method: 'POST' });

    expect(await screen.findByText(generateData.secret)).toBeInTheDocument();
    const qrImage = screen.getByAltText(`TOTP QR Code for ${defaultEmail}`);
    expect(qrImage).toBeInTheDocument();
    expect(qrImage).toHaveAttribute('src', generateData.qrCodeUrl);

    const input = screen.getByPlaceholderText('000000');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('surfaces an error and stays on step 1 when verification fails', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : '';
      if (url.includes('/api/auth/totp/generate')) {
        return new Response(JSON.stringify(generateData), { status: 200 });
      }
      return new Response(JSON.stringify({ success: false }), { status: 200 });
    });

    const onClose = vi.fn();
    render(<TotpSetupModal isOpen={true} onClose={onClose} userEmail={defaultEmail} />);

    await screen.findByText(generateData.secret);

    const input = screen.getByPlaceholderText('000000');
    fireEvent.change(input, { target: { value: '000111' } });

    const verifyButton = screen.getByRole('button', { name: 'Verify' });
    fireEvent.click(verifyButton);

    expect(await screen.findByText('Invalid token. Please try again.')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Set up Two-Factor Authentication' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Save Backup Codes')).not.toBeInTheDocument();
  });

  it('advances to step 2 and displays backup codes on successful verification', async () => {
    const onClose = vi.fn();
    render(<TotpSetupModal isOpen={true} onClose={onClose} userEmail={defaultEmail} />);

    await screen.findByText(generateData.secret);

    const input = screen.getByPlaceholderText('000000');
    fireEvent.change(input, { target: { value: '123456' } });

    const verifyButton = screen.getByRole('button', { name: 'Verify' });
    fireEvent.click(verifyButton);

    expect(await screen.findByRole('heading', { name: 'Save Backup Codes' })).toBeInTheDocument();
    for (const code of generateData.backupCodes) {
      expect(screen.getByText(code)).toBeInTheDocument();
    }
    expect(screen.queryByText('Set up Two-Factor Authentication')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I have saved these codes' })).toBeInTheDocument();
  });

  it('disables the verify button while verification is in flight (isVerifying)', async () => {
    let resolveVerify!: (res: Response) => void;
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : '';
      if (url.includes('/api/auth/totp/generate')) {
        return new Response(JSON.stringify(generateData), { status: 200 });
      }
      return new Promise<Response>((resolve) => {
        resolveVerify = resolve;
      });
    });

    const onClose = vi.fn();
    render(<TotpSetupModal isOpen={true} onClose={onClose} userEmail={defaultEmail} />);

    await screen.findByText(generateData.secret);

    const input = screen.getByPlaceholderText('000000');
    const verifyButton = screen.getByRole('button', { name: 'Verify' });

    // Initially disabled when input length < 6
    expect(verifyButton).toBeDisabled();

    fireEvent.change(input, { target: { value: '123456' } });
    expect(verifyButton).toBeEnabled();

    // Click verify: request is in flight
    fireEvent.click(verifyButton);
    expect(verifyButton).toBeDisabled();

    // Resolve the in-flight request
    resolveVerify(new Response(JSON.stringify({ success: true }), { status: 200 }));
    expect(await screen.findByRole('heading', { name: 'Save Backup Codes' })).toBeInTheDocument();
  });

  it('dismisses the modal via Cancel button on step 1', async () => {
    const onClose = vi.fn();
    render(<TotpSetupModal isOpen={true} onClose={onClose} userEmail={defaultEmail} />);

    await screen.findByText(generateData.secret);
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses the modal via finish button on step 2', async () => {
    const onClose = vi.fn();
    render(<TotpSetupModal isOpen={true} onClose={onClose} userEmail={defaultEmail} />);

    await screen.findByText(generateData.secret);
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    const finishButton = await screen.findByRole('button', {
      name: 'I have saved these codes',
    });
    fireEvent.click(finishButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('resets state when closed so reopening starts fresh at step 1 without stale token or error', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : '';
      if (url.includes('/api/auth/totp/generate')) {
        return new Response(JSON.stringify(generateData), { status: 200 });
      }
      return new Response(JSON.stringify({ success: false }), { status: 200 });
    });

    const onClose = vi.fn();
    const { rerender } = render(
      <TotpSetupModal isOpen={true} onClose={onClose} userEmail={defaultEmail} />,
    );

    await screen.findByText(generateData.secret);

    // Enter wrong token and verify to trigger error
    const input = screen.getByPlaceholderText('000000');
    fireEvent.change(input, { target: { value: '999999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('Invalid token. Please try again.')).toBeInTheDocument();

    // Close the modal
    rerender(<TotpSetupModal isOpen={false} onClose={onClose} userEmail={defaultEmail} />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();

    // Allow the close-reset timeout (0ms) to run
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Reopen the modal
    rerender(<TotpSetupModal isOpen={true} onClose={onClose} userEmail={defaultEmail} />);

    // Must be on step 1 with fresh state
    expect(
      await screen.findByRole('heading', { name: 'Set up Two-Factor Authentication' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Invalid token. Please try again.')).not.toBeInTheDocument();
    const freshInput = screen.getByPlaceholderText('000000');
    expect(freshInput).toHaveValue('');
  });
});
