import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ReceiptEmail, ReceiptEmailProps } from './ReceiptEmail';

const BASE_PROPS: ReceiptEmailProps = {
  txHash: 'abc123',
  merchantName: 'Test Merchant',
  amount: '10.00 USDC',
  date: '2026-03-04T23:20:00.000Z',
};

describe('ReceiptEmail date prop', () => {
  it('renders an ISO string date as a human-readable timestamp', () => {
    const { getByText } = render(<ReceiptEmail {...BASE_PROPS} date="2026-03-04T23:20:00.000Z" />);
    expect(getByText(/4 Mar 2026/i)).toBeTruthy();
  });

  it('renders a Date object in the same format as an ISO string for the same instant', () => {
    const iso = '2026-03-04T23:20:00.000Z';
    const { getByText: getByTextIso } = render(<ReceiptEmail {...BASE_PROPS} date={iso} />);
    const isoText = getByTextIso(/4 Mar 2026/i).textContent;

    const { getByText: getByTextDate } = render(
      <ReceiptEmail {...BASE_PROPS} date={new Date(iso)} />,
    );
    const dateText = getByTextDate(/4 Mar 2026/i).textContent;

    expect(dateText).toBe(isoText);
  });

  it('renders an epoch-milliseconds number in the same format as an ISO string', () => {
    const iso = '2026-03-04T23:20:00.000Z';
    const epoch = new Date(iso).getTime();

    const { getByText: getByTextIso } = render(<ReceiptEmail {...BASE_PROPS} date={iso} />);
    const isoText = getByTextIso(/4 Mar 2026/i).textContent;

    const { getByText: getByTextEpoch } = render(<ReceiptEmail {...BASE_PROPS} date={epoch} />);
    const epochText = getByTextEpoch(/4 Mar 2026/i).textContent;

    expect(epochText).toBe(isoText);
  });

  it('renders an em dash for an invalid date value', () => {
    const { getByText } = render(<ReceiptEmail {...BASE_PROPS} date="not-a-date" />);
    expect(getByText(/Date:/).textContent).toContain('—');
  });
});
