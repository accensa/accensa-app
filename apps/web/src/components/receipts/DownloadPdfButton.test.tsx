// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadPdfButton } from './DownloadPdfButton';
import type { ReceiptData } from '../../lib/pdf/ReceiptDocument';

const mockToBlob = vi.hoisted(() => vi.fn());

vi.mock('@react-pdf/renderer', () => ({
  pdf: vi.fn(() => ({ toBlob: mockToBlob })),
  StyleSheet: { create: (styles: unknown) => styles },
  Page: 'Page',
  Text: 'Text',
  View: 'View',
  Document: 'Document',
  Image: 'Image',
}));

const receiptData: ReceiptData = {
  receiptId: 'rcpt_123',
  date: '2026-01-01',
  merchantName: 'Acme',
  merchantAddress: 'G...',
  items: [{ description: 'Widget', quantity: 1, price: 10 }],
  total: 10,
  qrCodeDataUrl: 'data:image/png;base64,',
};

describe('DownloadPdfButton', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let alertSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('on a successful click: sets generating, downloads receipt-<id>.pdf, revokes the URL, and clears generating', async () => {
    const blob = new Blob(['pdf-bytes']);
    mockToBlob.mockResolvedValue(blob);

    render(<DownloadPdfButton receiptData={receiptData} />);
    const button = screen.getByRole('button');

    fireEvent.click(button);

    expect(screen.getByText('Generating PDF...')).toBeDefined();
    expect(button).toBeDisabled();

    await waitFor(() => expect(button).not.toBeDisabled());

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(screen.getByText('Download Receipt (PDF)')).toBeDefined();
  });

  it('downloads with the filename receipt-<receiptId>.pdf', async () => {
    const blob = new Blob(['pdf-bytes']);
    mockToBlob.mockResolvedValue(blob);
    let capturedDownloadName: string | undefined;
    clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
      capturedDownloadName = this.download;
    });

    render(<DownloadPdfButton receiptData={receiptData} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(capturedDownloadName).toBe('receipt-rcpt_123.pdf');
  });

  it('on a rejected toBlob: logs an error, shows an alert, and still clears generating', async () => {
    mockToBlob.mockRejectedValue(new Error('render failed'));

    render(<DownloadPdfButton receiptData={receiptData} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(button).toBeDisabled();

    await waitFor(() => expect(button).not.toBeDisabled());

    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to generate PDF:', expect.any(Error));
    expect(alertSpy).toHaveBeenCalledWith('Failed to generate PDF receipt. Please try again.');
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
