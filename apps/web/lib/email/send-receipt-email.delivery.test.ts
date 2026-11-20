import { describe, it, expect } from 'vitest';
import { sendReceiptEmail, SendReceiptResult } from './index';

const BASE_PROPS = {
  txHash: 'abc123deadbeef',
  merchantName: 'Test Merchant',
  amount: '10.00 USDC',
  date: '2026-03-04T23:20:00.000Z' as const,
};

describe('sendReceiptEmail delivery status', () => {
  it('returns not-configured for a valid recipient when no provider is set up', async () => {
    const result = await sendReceiptEmail('user@example.com', BASE_PROPS);
    expect(result.status).toBe('not-configured');
  });

  it('returns invalid-recipient for an address with no @', async () => {
    const result = await sendReceiptEmail('notanemail', BASE_PROPS);
    expect(result.status).toBe('invalid-recipient');
  });

  it('returns invalid-recipient for an address with no domain', async () => {
    const result = await sendReceiptEmail('user@', BASE_PROPS);
    expect(result.status).toBe('invalid-recipient');
  });

  it('returns invalid-recipient for an empty string', async () => {
    const result = await sendReceiptEmail('', BASE_PROPS);
    expect(result.status).toBe('invalid-recipient');
  });

  it('returns invalid-recipient for an address containing spaces', async () => {
    const result = await sendReceiptEmail('user @example.com', BASE_PROPS);
    expect(result.status).toBe('invalid-recipient');
  });

  it('result status is a discriminated union member', async () => {
    const result: SendReceiptResult = await sendReceiptEmail('valid@example.com', BASE_PROPS);
    const validStatuses = ['sent', 'not-configured', 'invalid-recipient'];
    expect(validStatuses).toContain(result.status);
  });
});
