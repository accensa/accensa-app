import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { ReceiptEmailProps } from '../../emails/ReceiptEmail';
import { sendReceiptEmail } from './index';

// The receipt-email adapter is a stub today, but callers already depend on the
// shape it returns and on the arguments it takes (#409 left both unpinned).
// A test that read console.log would pin the wrong contract: the log line is
// debugging output, and the caller consumes the result object. These tests pin
// the result, the arguments and the fact that a call leaves its caller's data
// alone — none of them inspect stdout.

function props(overrides: Partial<ReceiptEmailProps> = {}): ReceiptEmailProps {
  // A complete literal per emails/ReceiptEmail.tsx, so a new required prop
  // fails this test rather than passing as a partial.
  return {
    txHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    merchantName: 'Ada Coffee',
    amount: '12.50 USDC',
    date: '2026-09-15',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendReceiptEmail', () => {
  it('returns exactly { success: true }', async () => {
    // The stub logs; silence it so the test output stays readable. Nothing
    // below asserts on it.
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await sendReceiptEmail('merchant@example.com', props());

    expect(result).toEqual({ success: true });
    expect(Object.keys(result)).toEqual(['success']);
    expect(typeof result.success).toBe('boolean');
  });

  it('returns a distinct result for each call and mutates neither props object', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const first = props({ txHash: 'first-hash' });
    const second = props({ merchantName: 'Second Merchant', txHash: 'second-hash' });
    const firstBefore = structuredClone(first);
    const secondBefore = structuredClone(second);

    const firstResult = await sendReceiptEmail('one@example.com', first);
    const secondResult = await sendReceiptEmail('two@example.com', second);

    // Distinct objects: a shared singleton would let one caller's mutation
    // reach the next caller's result.
    expect(firstResult).not.toBe(secondResult);
    expect(firstResult).toEqual({ success: true });
    expect(secondResult).toEqual({ success: true });

    // The adapter reads the props; it must not write them.
    expect(first).toEqual(firstBefore);
    expect(second).toEqual(secondBefore);
  });

  it('has a typed two-argument signature and a Promise<{ success: boolean }> result', () => {
    expectTypeOf(sendReceiptEmail).parameters.toEqualTypeOf<[string, ReceiptEmailProps]>();
    expectTypeOf(sendReceiptEmail).returns.resolves.toEqualTypeOf<{ success: boolean }>();
  });
});
