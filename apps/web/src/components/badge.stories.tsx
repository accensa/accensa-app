import type { Meta, StoryObj } from '@storybook/nextjs';
import { Badge } from './badge';

const meta = {
  title: 'UI/Badge',
  component: Badge,
  args: { children: 'GET' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = { args: { tone: 'neutral', children: 'queued' } };
export const Success: Story = { args: { tone: 'success', children: 'settled' } };
export const Warning: Story = { args: { tone: 'warning', children: 'refunded' } };
export const Danger: Story = { args: { tone: 'danger', children: 'failed' } };
