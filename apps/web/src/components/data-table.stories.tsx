import type { Meta, StoryObj } from '@storybook/nextjs';
import { DataTable } from './data-table';
import { Badge } from './badge';

const rows = [
  { id: '1', tx: 'aaaa…1111', amount: '1.50 XLM', route: '/api/resource' },
  { id: '2', tx: 'bbbb…2222', amount: '0.25 XLM', route: '/v1/quote' },
];

const columns = [
  { key: 'tx', header: 'Transaction', render: (row: (typeof rows)[0]) => row.tx },
  { key: 'amount', header: 'Amount', render: (row: (typeof rows)[0]) => row.amount },
  {
    key: 'route',
    header: 'Route',
    render: (row: (typeof rows)[0]) => <Badge tone="success">{row.route}</Badge>,
  },
];

const meta = {
  title: 'UI/DataTable',
  component: DataTable,
  args: { columns, rows },
} satisfies Meta<typeof DataTable<(typeof rows)[0]>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};
export const Empty: Story = {
  args: { rows: [], empty: 'Payments settled to this merchant will appear here.' },
};
export const Loading: Story = { args: { rows: [], loading: true } };
