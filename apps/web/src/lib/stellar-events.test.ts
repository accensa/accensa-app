import { describe, it, expect } from 'vitest';
import {
  decodeTransferEvent,
  stroopsToDecimal,
  transferTopicFilter,
  type RawEvent,
} from './stellar-events';
import fixture from './__fixtures__/sac-transfer-events.json';

describe('stroopsToDecimal', () => {
  it('formats whole and fractional amounts at 7 places', () => {
    expect(stroopsToDecimal(125_000_000n)).toBe('12.5000000');
    expect(stroopsToDecimal(10_000_000n)).toBe('1.0000000');
    expect(stroopsToDecimal(0n)).toBe('0.0000000');
  });

  it('preserves a single stroop', () => {
    // The whole point of not using floats: this must not round away.
    expect(stroopsToDecimal(1n)).toBe('0.0000001');
  });

  it('handles amounts beyond Number.MAX_SAFE_INTEGER without loss', () => {
    const huge = 90_071_992_547_409_910_000n;
    expect(stroopsToDecimal(huge)).toBe('9007199254740.9910000');
    // Proof this would have been corrupted by a float round-trip.
    expect(Number(huge).toString()).not.toBe(huge.toString());
  });

  it('handles negative amounts', () => {
    expect(stroopsToDecimal(-125_000_000n)).toBe('-12.5000000');
  });
});

describe('decodeTransferEvent — against real testnet events', () => {
  const events = fixture.events as RawEvent[];

  it('decodes every captured event', () => {
    const decoded = events.map(decodeTransferEvent);
    expect(decoded.every((d) => d !== null)).toBe(true);
  });

  it('decodes the known transfer exactly as it was submitted', () => {
    const known = events.find((e) => e.txHash === fixture.known.txHash);
    expect(known).toBeDefined();

    const decoded = decodeTransferEvent(known!);
    expect(decoded).not.toBeNull();
    expect(decoded!.from).toBe(fixture.known.expected.from);
    expect(decoded!.to).toBe(fixture.known.expected.to);
    expect(decoded!.asset).toBe(fixture.known.expected.asset);
    expect(decoded!.stroops.toString()).toBe(fixture.known.expected.stroops);
    expect(decoded!.amount).toBe(fixture.known.expected.amount);
  });

  it('returns amount as a string, never a number', () => {
    const decoded = decodeTransferEvent(events[0])!;
    expect(typeof decoded.amount).toBe('string');
    expect(typeof decoded.stroops).toBe('bigint');
  });

  it('carries ledger and close time through', () => {
    const decoded = decodeTransferEvent(events[0])!;
    expect(decoded.ledger).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(decoded.ledgerClosedAt))).toBe(false);
  });
});

describe('decodeTransferEvent — malformed input', () => {
  const valid = (fixture.events as RawEvent[])[0];

  it('returns null rather than throwing on too few topics', () => {
    expect(decodeTransferEvent({ ...valid, topic: [] })).toBeNull();
  });

  it('returns null on undecodable topic XDR', () => {
    expect(decodeTransferEvent({ ...valid, topic: ['not-base64-xdr', 'x', 'y'] })).toBeNull();
  });

  it('returns null on a missing value', () => {
    expect(decodeTransferEvent({ ...valid, value: undefined })).toBeNull();
  });

  it('returns null on undecodable value XDR', () => {
    expect(decodeTransferEvent({ ...valid, value: 'garbage' })).toBeNull();
  });

  it('returns null for a non-transfer event', () => {
    // A "fee" event: right shape, wrong name. Must not be counted as revenue.
    const fee: RawEvent = {
      ...valid,
      topic: [
        'AAAADwAAAANmZWUA',
        'AAAAEgAAAAAAAAAAl2Uc5zBdi7JyKFLTCKSyIcbmwDZj4zw8atklhxblH7Y=',
        'AAAAEgAAAAAAAAAAl2Uc5zBdi7JyKFLTCKSyIcbmwDZj4zw8atklhxblH7Y=',
      ],
    };
    expect(decodeTransferEvent(fee)).toBeNull();
  });
});

describe('transferTopicFilter', () => {
  it('produces a stable base64 XDR filter for the transfer symbol', () => {
    const filter = transferTopicFilter();
    expect(typeof filter).toBe('string');
    // Round-trips back through the decoder as the topic of a real event.
    const known = (fixture.events as RawEvent[]).find(
      (e) => e.txHash === fixture.known.txHash,
    )!;
    expect(known.topic![0]).toBe(filter);
  });
});
