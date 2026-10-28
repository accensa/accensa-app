// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportModal } from './ExportModal';

describe('ExportModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens an export URL containing the chosen date range and calls onClose', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onClose = vi.fn();

    const { container } = render(<ExportModal isOpen onClose={onClose} />);
    const dateInputs = container.querySelectorAll('input[type="date"]');

    fireEvent.change(dateInputs[0], { target: { value: '2026-01-01' } });
    fireEvent.change(dateInputs[1], { target: { value: '2026-01-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target] = openSpy.mock.calls[0];
    expect(target).toBe('_blank');

    const params = new URL(url as string, 'http://localhost').searchParams;
    expect(params.get('date_from')).toBe(new Date('2026-01-01').toISOString());
    expect(params.get('date_to')).toBe(new Date('2026-01-31').toISOString());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not reflect the status or format selectors in the export URL (pins the current, inert-selector behavior)', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onClose = vi.fn();

    render(<ExportModal isOpen onClose={onClose} />);

    fireEvent.change(screen.getByDisplayValue('CSV (Accounting / Ledger)'), {
      target: { value: 'excel' },
    });
    fireEvent.change(screen.getByDisplayValue('All Transactions'), {
      target: { value: 'refunded' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    const [url] = openSpy.mock.calls[0];
    const params = new URL(url as string, 'http://localhost').searchParams;

    // Neither `format` nor `status` reaches the request today, even though the
    // user picked "excel" and "refunded" — handleExport never sets them. This
    // is the inert-selector gap the issue flags as a suspected bug, not an
    // ideal this test asserts; a fix belongs to a separate issue.
    expect(params.has('format')).toBe(false);
    expect(params.has('status')).toBe(false);
  });

  it('closing without exporting opens no window', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const onClose = vi.fn();

    render(<ExportModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(openSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<ExportModal isOpen={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
