import type { Meta, StoryObj } from '@storybook/nextjs';
import { CtaButton } from './cta-button';

const meta = {
  title: 'UI/CtaButton',
  component: CtaButton,
  args: { href: '/dashboard', children: 'Open dashboard' },
} satisfies Meta<typeof CtaButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: 'primary' } };
export const Secondary: Story = { args: { variant: 'secondary' } };
