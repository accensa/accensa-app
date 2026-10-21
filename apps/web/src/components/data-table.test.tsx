// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type DataTableColumn } from './data-table';

interface Row {
  id: string;
  name: string;
}

const columns: DataTableColumn<Row>[] = [
  { key: 'name', header: 'Name', render: (row) => row.name },
];

const rows: Row[] = [
  { id: '1', name: 'Alpha' },
  { id: '2', name: 'Beta' },
];

describe('DataTable', () => {
  it('renders the loading affordance and no rows while loading', () => {
    render(<DataTable columns={columns} rows={rows} loading />);

    expect(screen.getByTestId('data-table-loading')).toBeDefined();
    expect(screen.queryByTestId('data-table')).toBeNull();
    expect(screen.queryByText('Alpha')).toBeNull();
  });

  it('renders the default empty state when there are no rows', () => {
    render(<DataTable columns={columns} rows={[]} />);

    const empty = screen.getByTestId('data-table-empty');
    expect(empty).toBeDefined();
    expect(empty.textContent).toContain('No rows');
  });

  it('renders a custom empty node when supplied', () => {
    render(<DataTable columns={columns} rows={[]} empty={<span>Nothing here</span>} />);

    const empty = screen.getByTestId('data-table-empty');
    expect(empty.textContent).toContain('Nothing here');
  });

  it('renders one row per item for a populated dataset', () => {
    render(<DataTable columns={columns} rows={rows} />);

    expect(screen.getByText('Alpha')).toBeDefined();
    expect(screen.getByText('Beta')).toBeDefined();
  });

  it('invokes onRowClick with the clicked row when the prop is provided', () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} rows={rows} onRowClick={onRowClick} />);

    fireEvent.click(screen.getByText('Alpha'));

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it('attaches no click wiring when onRowClick is omitted', () => {
    render(<DataTable columns={columns} rows={rows} />);

    const row = screen.getByText('Alpha').closest('tr');
    expect(row?.className).not.toContain('cursor-pointer');

    // Clicking is a no-op: nothing throws without a handler attached.
    expect(() => fireEvent.click(screen.getByText('Alpha'))).not.toThrow();
  });
});
