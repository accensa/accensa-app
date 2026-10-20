// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditTable, type AuditLog } from './AuditTable';

const mockLogs: AuditLog[] = [
  {
    id: 'log-1',
    actor: 'admin@merchant.com',
    ipAddress: '192.168.1.100',
    timestamp: '2026-10-18T10:30:00.000Z',
    actionType: 'Changed Treasury Address',
    details: {
      description: 'Updated treasury to cold storage address',
      before: { address: 'GABC1234567890OLD' },
      after: { address: 'GXYZ0987654321NEW' },
    },
  },
  {
    id: 'log-2',
    actor: 'staff@merchant.com',
    ipAddress: '10.0.0.50',
    timestamp: '2026-10-17T15:45:00.000Z',
    actionType: 'Issued Refund',
    details: {
      description: 'Refunded $45.00 for order #12345',
    },
  },
  {
    id: 'log-3',
    actor: 'security@merchant.com',
    ipAddress: '172.16.0.20',
    timestamp: '2026-10-16T08:00:00.000Z',
    actionType: 'Revoked API Key',
    details: {
      before: { keyId: 'key_123', status: 'active' },
      after: { keyId: 'key_123', status: 'revoked' },
    },
  },
];

describe('AuditTable', () => {
  const onFilterChangeMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering and Loading States', () => {
    it('renders audit trail heading and table headers', () => {
      render(
        <AuditTable logs={mockLogs} isLoading={false} onFilterChange={onFilterChangeMock} />,
      );

      expect(screen.getByRole('heading', { name: 'Audit Trail' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Timestamp' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Actor' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Action' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'IP Address' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Details' })).toBeInTheDocument();
    });

    it('renders all audit log rows with formatted timestamps and metadata', () => {
      render(
        <AuditTable logs={mockLogs} isLoading={false} onFilterChange={onFilterChangeMock} />,
      );

      expect(screen.getByText('admin@merchant.com')).toBeInTheDocument();
      expect(screen.getByText('Changed Treasury Address')).toBeInTheDocument();
      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();

      expect(screen.getByText('staff@merchant.com')).toBeInTheDocument();
      expect(screen.getByText('Issued Refund')).toBeInTheDocument();
      expect(screen.getByText('10.0.0.50')).toBeInTheDocument();

      expect(screen.getByText('security@merchant.com')).toBeInTheDocument();
      expect(screen.getByText('Revoked API Key')).toBeInTheDocument();
      expect(screen.getByText('172.16.0.20')).toBeInTheDocument();

      const viewButtons = screen.getAllByRole('button', { name: 'View' });
      expect(viewButtons).toHaveLength(3);
    });

    it('shows loading indicator and hides table when isLoading is true', () => {
      render(
        <AuditTable logs={mockLogs} isLoading={true} onFilterChange={onFilterChangeMock} />,
      );

      expect(screen.getByText('Loading logs...')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('displays empty state message when logs array is empty and not loading', () => {
      render(<AuditTable logs={[]} isLoading={false} onFilterChange={onFilterChangeMock} />);

      expect(
        screen.getByText('No audit logs found matching your criteria.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('table')).toBeInTheDocument();
    });
  });

  describe('CSV Export', () => {
    let clickSpy: ReturnType<typeof vi.spyOn>;
    let appendChildSpy: ReturnType<typeof vi.spyOn>;
    let removeChildSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      appendChildSpy = vi.spyOn(document.body, 'appendChild');
      removeChildSpy = vi.spyOn(document.body, 'removeChild');
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('provides an export CSV button and triggers download with correct file name and header', () => {
      render(
        <AuditTable logs={mockLogs} isLoading={false} onFilterChange={onFilterChangeMock} />,
      );

      const exportBtn = screen.getByRole('button', { name: 'Export CSV' });
      expect(exportBtn).toBeInTheDocument();

      fireEvent.click(exportBtn);

      expect(appendChildSpy).toHaveBeenCalledTimes(1);
      const link = appendChildSpy.mock.calls[0][0] as HTMLAnchorElement;
      expect(link.tagName).toBe('A');
      expect(link.getAttribute('download')).toBe('audit_logs_export.csv');

      const href = link.getAttribute('href')!;
      expect(href.startsWith('data:text/csv;charset=utf-8,')).toBe(true);

      const decoded = decodeURI(href);
      expect(decoded).toContain('Timestamp,Actor,Action,IP Address');
      expect(decoded).toContain(
        '2026-10-18T10:30:00.000Z,admin@merchant.com,Changed Treasury Address,192.168.1.100',
      );
      expect(decoded).toContain(
        '2026-10-17T15:45:00.000Z,staff@merchant.com,Issued Refund,10.0.0.50',
      );
      expect(decoded).toContain(
        '2026-10-16T08:00:00.000Z,security@merchant.com,Revoked API Key,172.16.0.20',
      );

      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(removeChildSpy).toHaveBeenCalledWith(link);
    });

    it('exports CSV with only headers when logs array is empty', () => {
      render(<AuditTable logs={[]} isLoading={false} onFilterChange={onFilterChangeMock} />);

      const exportBtn = screen.getByRole('button', { name: 'Export CSV' });
      fireEvent.click(exportBtn);

      expect(appendChildSpy).toHaveBeenCalledTimes(1);
      const link = appendChildSpy.mock.calls[0][0] as HTMLAnchorElement;
      const decoded = decodeURI(link.getAttribute('href')!);

      expect(decoded).toBe('data:text/csv;charset=utf-8,Timestamp,Actor,Action,IP Address\n');
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(removeChildSpy).toHaveBeenCalledWith(link);
    });

    it('handles special characters and URI encoding properly in CSV output', () => {
      const specialLogs: AuditLog[] = [
        {
          id: 'log-spec',
          actor: 'user+test@example.com',
          ipAddress: '2001:db8::1',
          timestamp: '2026-10-19T12:00:00.000Z',
          actionType: 'Updated Key [Scope: admin & write]',
          details: {},
        },
      ];

      render(
        <AuditTable logs={specialLogs} isLoading={false} onFilterChange={onFilterChangeMock} />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

      const link = appendChildSpy.mock.calls[0][0] as HTMLAnchorElement;
      const rawHref = link.getAttribute('href')!;
      expect(rawHref).toContain('data:text/csv;charset=utf-8,');

      const decoded = decodeURI(rawHref);
      expect(decoded).toContain(
        '2026-10-19T12:00:00.000Z,user+test@example.com,Updated Key [Scope: admin & write],2001:db8::1',
      );
    });

    it('repeated exports do not accumulate duplicate rows or stale data', () => {
      const { rerender } = render(
        <AuditTable logs={[mockLogs[0]]} isLoading={false} onFilterChange={onFilterChangeMock} />,
      );

      const exportBtn = screen.getByRole('button', { name: 'Export CSV' });
      fireEvent.click(exportBtn);

      const firstLink = appendChildSpy.mock.calls[0][0] as HTMLAnchorElement;
      const firstDecoded = decodeURI(firstLink.getAttribute('href')!);
      const firstRowCount = firstDecoded.trim().split('\n').length;
      expect(firstRowCount).toBe(2); // Header + 1 row

      // Rerender with different logs
      rerender(
        <AuditTable logs={[mockLogs[1]]} isLoading={false} onFilterChange={onFilterChangeMock} />,
      );

      fireEvent.click(exportBtn);

      expect(appendChildSpy).toHaveBeenCalledTimes(2);
      const secondLink = appendChildSpy.mock.calls[1][0] as HTMLAnchorElement;
      const secondDecoded = decodeURI(secondLink.getAttribute('href')!);
      const secondRowCount = secondDecoded.trim().split('\n').length;
      expect(secondRowCount).toBe(2); // Header + 1 row
      expect(secondDecoded).toContain('staff@merchant.com');
      expect(secondDecoded).not.toContain('admin@merchant.com');
    });
  });

  describe('Row Toggle Behavior', () => {
    it('expands row details on clicking View and collapses on clicking Hide', () => {
      render(
        <AuditTable logs={mockLogs} isLoading={false} onFilterChange={onFilterChangeMock} />,
      );

      // Initially details are not visible
      expect(
        screen.queryByText('Updated treasury to cold storage address'),
      ).not.toBeInTheDocument();

      const viewButtons = screen.getAllByRole('button', { name: 'View' });
      fireEvent.click(viewButtons[0]);

      // Row 1 should now be expanded
      expect(
        screen.getByText('Updated treasury to cold storage address'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();

      // Click Hide to collapse
      fireEvent.click(screen.getByRole('button', { name: 'Hide' }));

      // Details should be collapsed
      expect(
        screen.queryByText('Updated treasury to cold storage address'),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Hide' })).not.toBeInTheDocument();
    });

    it('maintains independent row selection and single-expanded state across multiple rows', () => {
      render(
        <AuditTable logs={mockLogs} isLoading={false} onFilterChange={onFilterChangeMock} />,
      );

      const viewButtons = screen.getAllByRole('button', { name: 'View' });
      expect(viewButtons).toHaveLength(3);

      // Expand row 1
      fireEvent.click(viewButtons[0]);
      expect(
        screen.getByText('Updated treasury to cold storage address'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Refunded $45.00 for order #12345'),
      ).not.toBeInTheDocument();

      // Expand row 2 (which collapses row 1)
      const remainingViewButtons = screen.getAllByRole('button', { name: 'View' });
      fireEvent.click(remainingViewButtons[0]); // This is row 2's button

      expect(
        screen.queryByText('Updated treasury to cold storage address'),
      ).not.toBeInTheDocument();
      expect(screen.getByText('Refunded $45.00 for order #12345')).toBeInTheDocument();

      // Collapsing row 2 leaves all collapsed
      const hideButton = screen.getByRole('button', { name: 'Hide' });
      fireEvent.click(hideButton);

      expect(
        screen.queryByText('Refunded $45.00 for order #12345'),
      ).not.toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'View' })).toHaveLength(3);
    });
  });

  describe('Diff View', () => {
    it('renders before and after diff JSON panels when both are present', () => {
      render(
        <AuditTable logs={mockLogs} isLoading={false} onFilterChange={onFilterChangeMock} />,
      );

      const viewButtons = screen.getAllByRole('button', { name: 'View' });
      fireEvent.click(viewButtons[0]); // Row 1 has before and after

      expect(screen.getByText('Before:')).toBeInTheDocument();
      expect(screen.getByText('After:')).toBeInTheDocument();

      expect(screen.getByText(/"address":\s*"GABC1234567890OLD"/)).toBeInTheDocument();
      expect(screen.getByText(/"address":\s*"GXYZ0987654321NEW"/)).toBeInTheDocument();
    });

    it('renders only description without diff panels when before/after are absent', () => {
      render(
        <AuditTable logs={mockLogs} isLoading={false} onFilterChange={onFilterChangeMock} />,
      );

      const viewButtons = screen.getAllByRole('button', { name: 'View' });
      fireEvent.click(viewButtons[1]); // Row 2 only has description

      expect(screen.getByText('Refunded $45.00 for order #12345')).toBeInTheDocument();
      expect(screen.queryByText('Before:')).not.toBeInTheDocument();
      expect(screen.queryByText('After:')).not.toBeInTheDocument();
    });

    it('renders diff panels without description when description is absent', () => {
      render(
        <AuditTable logs={mockLogs} isLoading={false} onFilterChange={onFilterChangeMock} />,
      );

      const viewButtons = screen.getAllByRole('button', { name: 'View' });
      fireEvent.click(viewButtons[2]); // Row 3 has before/after but no description

      expect(screen.getByText('Before:')).toBeInTheDocument();
      expect(screen.getByText('After:')).toBeInTheDocument();
      expect(screen.getByText(/"status":\s*"active"/)).toBeInTheDocument();
      expect(screen.getByText(/"status":\s*"revoked"/)).toBeInTheDocument();
    });

    it('handles empty diff objects and missing details without errors', () => {
      const edgeCaseLogs: AuditLog[] = [
        {
          id: 'log-empty',
          actor: 'test@example.com',
          ipAddress: '127.0.0.1',
          timestamp: '2026-10-19T00:00:00.000Z',
          actionType: 'Empty Diff Action',
          details: {
            before: {},
            after: {},
          },
        },
        {
          id: 'log-no-details',
          actor: 'test2@example.com',
          ipAddress: '127.0.0.1',
          timestamp: '2026-10-19T01:00:00.000Z',
          actionType: 'No Details Action',
          details: {},
        },
      ];

      render(
        <AuditTable logs={edgeCaseLogs} isLoading={false} onFilterChange={onFilterChangeMock} />,
      );

      // Expand log with empty diff objects
      const viewButtons = screen.getAllByRole('button', { name: 'View' });
      fireEvent.click(viewButtons[0]);

      expect(screen.getByText('Before:')).toBeInTheDocument();
      expect(screen.getByText('After:')).toBeInTheDocument();

      // Expand log with no details at all
      const nextViewButtons = screen.getAllByRole('button', { name: 'View' });
      fireEvent.click(nextViewButtons[0]);

      expect(screen.queryByText('Before:')).not.toBeInTheDocument();
      expect(screen.queryByText('After:')).not.toBeInTheDocument();
    });
  });

  describe('Filter Controls', () => {
    it('allows entering actor filter and selecting action filter', () => {
      render(
        <AuditTable logs={mockLogs} isLoading={false} onFilterChange={onFilterChangeMock} />,
      );

      const actorInput = screen.getByPlaceholderText('Filter by actor (email)');
      const actionSelect = screen.getByRole('combobox');
      const applyBtn = screen.getByRole('button', { name: 'Apply Filters' });

      fireEvent.change(actorInput, { target: { value: 'admin@merchant.com' } });
      fireEvent.change(actionSelect, { target: { value: 'Changed Treasury Address' } });
      fireEvent.click(applyBtn);

      expect(onFilterChangeMock).toHaveBeenCalledTimes(1);
      expect(onFilterChangeMock).toHaveBeenCalledWith({
        actor: 'admin@merchant.com',
        actionType: 'Changed Treasury Address',
      });
    });

    it('submits empty filters when filter fields are cleared or untouched', () => {
      render(
        <AuditTable logs={mockLogs} isLoading={false} onFilterChange={onFilterChangeMock} />,
      );

      const applyBtn = screen.getByRole('button', { name: 'Apply Filters' });
      fireEvent.click(applyBtn);

      expect(onFilterChangeMock).toHaveBeenCalledWith({
        actor: '',
        actionType: '',
      });
    });
  });
});
