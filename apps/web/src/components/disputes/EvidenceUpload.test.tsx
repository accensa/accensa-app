// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EvidenceUpload,
  MAX_EVIDENCE_BYTES,
  validateEvidenceFile,
} from './EvidenceUpload';

describe('validateEvidenceFile', () => {
  it('returns the type message for text/plain', () => {
    const error = validateEvidenceFile({ type: 'text/plain', size: 1024 });
    expect(error).toBe('Upload a PDF, JPG, or PNG file.');
  });

  it('returns the size message for files above 10 MiB', () => {
    const error = validateEvidenceFile({
      type: 'application/pdf',
      size: MAX_EVIDENCE_BYTES + 1,
    });
    expect(error).toBe('Evidence files must be 10 MB or smaller.');
  });

  it('returns null at exactly 10 MiB', () => {
    const error = validateEvidenceFile({
      type: 'application/pdf',
      size: MAX_EVIDENCE_BYTES,
    });
    expect(error).toBeNull();
  });

  it('returns the TYPE error for a file that is both wrong type and oversized', () => {
    const error = validateEvidenceFile({
      type: 'text/plain',
      size: MAX_EVIDENCE_BYTES + 5000,
    });
    expect(error).toBe('Upload a PDF, JPG, or PNG file.');
  });
});

describe('EvidenceUpload component', () => {
  const originalFetch = global.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function getDropZone() {
    return screen
      .getByText('Upload proof of shipment, tracking, or signed invoices.')
      .closest('div')!;
  }

  it('shows the role="alert" text and performs NO fetch on invalid drop', () => {
    render(<EvidenceUpload disputeId="dispute-1" />);

    const invalidFile = new File(['text content'], 'notes.txt', { type: 'text/plain' });
    fireEvent.drop(getDropZone(), {
      dataTransfer: { files: [invalidFile] },
    });

    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
    expect(alert.textContent).toBe('Upload a PDF, JPG, or PNG file.');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('produces exactly one POST whose FormData contains file and disputeId sent to encoded path', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ cid: 'bafy-test-cid-1' }), { status: 200 }),
    );

    const disputeIdWithSpecialChars = 'disp 100/audit branch';
    render(<EvidenceUpload disputeId={disputeIdWithSpecialChars} />);

    const validFile = new File(['pdf binary data'], 'receipt.pdf', {
      type: 'application/pdf',
    });
    fireEvent.drop(getDropZone(), {
      dataTransfer: { files: [validFile] },
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`/api/disputes/${encodeURIComponent(disputeIdWithSpecialChars)}/evidence`);
    expect(url).toContain('disp%20100%2Faudit%20branch');
    expect(init?.method).toBe('POST');

    const formData = init?.body as FormData;
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get('disputeId')).toBe(disputeIdWithSpecialChars);
    const uploadedFile = formData.get('file') as File;
    expect(uploadedFile).toBeInstanceOf(File);
    expect(uploadedFile.name).toBe('receipt.pdf');
  });

  it('shows "Pinning evidence..." while upload is in flight', async () => {
    let resolveInFlight!: (value: Response) => void;
    mockFetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveInFlight = resolve;
      }),
    );

    render(<EvidenceUpload disputeId="dispute-2" />);

    const validFile = new File(['image bytes'], 'screenshot.png', {
      type: 'image/png',
    });
    fireEvent.drop(getDropZone(), {
      dataTransfer: { files: [validFile] },
    });

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Pinning evidence...');
    });

    resolveInFlight(
      new Response(JSON.stringify({ cid: 'bafy-flight-cid' }), { status: 200 }),
    );

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Evidence pinned successfully.');
    });
  });

  it('shows "Evidence could not be pinned." on 500 response and leaves status region empty', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Server crash' }), { status: 500 }),
    );

    render(<EvidenceUpload disputeId="dispute-3" />);

    const validFile = new File(['jpeg bytes'], 'photo.jpg', {
      type: 'image/jpeg',
    });
    fireEvent.drop(getDropZone(), {
      dataTransfer: { files: [validFile] },
    });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Evidence could not be pinned.');
    });

    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('shows the thrown message on a network throw', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network offline or socket timeout'));

    render(<EvidenceUpload disputeId="dispute-4" />);

    const validFile = new File(['pdf data'], 'invoice.pdf', {
      type: 'application/pdf',
    });
    fireEvent.drop(getDropZone(), {
      dataTransfer: { files: [validFile] },
    });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Network offline or socket timeout');
    });

    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('shows success message and calls onUploaded with returned cid, and works when onUploaded is omitted', async () => {
    const onUploaded = vi.fn();
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ cid: 'cid-qwerty-123' }), { status: 200 }),
    );

    const { rerender } = render(
      <EvidenceUpload disputeId="dispute-5" onUploaded={onUploaded} />,
    );

    const validFile1 = new File(['pdf data'], 'doc1.pdf', {
      type: 'application/pdf',
    });
    fireEvent.drop(getDropZone(), {
      dataTransfer: { files: [validFile1] },
    });

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Evidence pinned successfully.');
    });
    expect(onUploaded).toHaveBeenCalledWith('cid-qwerty-123');

    // Test with onUploaded omitted
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ cid: 'cid-omitted-456' }), { status: 200 }),
    );
    rerender(<EvidenceUpload disputeId="dispute-5" />);

    const validFile2 = new File(['pdf data'], 'doc2.pdf', {
      type: 'application/pdf',
    });
    fireEvent.drop(getDropZone(), {
      dataTransfer: { files: [validFile2] },
    });

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Evidence pinned successfully.');
    });
  });

  it('calls preventDefault on dragover and drop, clears dragging styling state on drop, and triggers no fetch on empty FileList', () => {
    render(<EvidenceUpload disputeId="dispute-6" />);

    const dropZone = getDropZone();

    // Initial state: border-slate-300, not dragging
    expect(dropZone.className).toContain('border-slate-300');
    expect(dropZone.className).not.toContain('border-emerald-600 bg-emerald-50');

    // dragover calls preventDefault and sets dragging styling state
    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true });
    const dragOverPreventDefaultSpy = vi.spyOn(dragOverEvent, 'preventDefault');
    dropZone.dispatchEvent(dragOverEvent);

    expect(dragOverPreventDefaultSpy).toHaveBeenCalled();
    expect(dropZone.className).toContain('border-emerald-600 bg-emerald-50');

    // drop calls preventDefault, clears dragging state, and dropping empty FileList triggers no fetch
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [] },
    });
    const dropPreventDefaultSpy = vi.spyOn(dropEvent, 'preventDefault');
    dropZone.dispatchEvent(dropEvent);

    expect(dropPreventDefaultSpy).toHaveBeenCalled();
    expect(dropZone.className).not.toContain('border-emerald-600 bg-emerald-50');
    expect(dropZone.className).toContain('border-slate-300');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
