import { describe, expect, it } from 'vitest';
import { xdr, nativeToScVal, Address } from '@stellar/stellar-sdk';
import {
  decodeAccensaEvent,
  tryDecodeAccensaEvent,
  matchAccensaEvent,
  isDepositEvent,
  isRefundEvent,
  isDisputeEvent,
  isAnchorEvent,
  isMultisigEvent,
  depositTopicFilter,
  refundTopicFilter,
  disputeTopicFilter,
  anchorTopicFilter,
  multisigTopicFilter,
  EventDecodeError,
  type DepositEvent,
  type RefundEvent,
  type DisputeEvent,
  type AnchorEvent,
  type MultisigEvent,
  type AccensaEvent,
} from './index';

const ALICE = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const BOB = 'GBKNGF67M4FBWNCNIFR4LTFXHZD5RDUSMQ5YJL4R7R7N7OXOWLIEMVYV';
const VAULT = 'CCMBM44EJUGD52G4LSMGHSXMAH2KSAQZX7VOYY4TTBF5BK4D7M4IHRQA';
const TOKEN_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

function createRawEvent(
  topics: (xdr.ScVal | string)[],
  value: xdr.ScVal | unknown,
  overrides = {},
) {
  return {
    id: '0000000001',
    contractId: VAULT,
    txHash: 'e'.repeat(64),
    ledger: 98765,
    ledgerClosedAt: '2026-11-24T12:00:00Z',
    topic: topics.map((t) => (t instanceof xdr.ScVal ? t.toXDR('base64') : t)),
    value: value instanceof xdr.ScVal ? value.toXDR('base64') : value,
    ...overrides,
  };
}

describe('Soroban Contract Event Decoder Unit Test Suite', () => {
  describe('DepositEvent deserialization', () => {
    it('decodes standard deposit event with native ScVal map payload', () => {
      const raw = createRawEvent(
        [
          xdr.ScVal.scvSymbol('deposit'),
          new Address(ALICE).toScVal(),
          new Address(VAULT).toScVal(),
          xdr.ScVal.scvString('native'),
        ],
        nativeToScVal({
          amount: 50_000_000n, // 5.0 XLM
          deposit_id: 101,
        }),
      );

      const event = decodeAccensaEvent(raw);
      expect(isDepositEvent(event)).toBe(true);

      if (isDepositEvent(event)) {
        expect(event.type).toBe('deposit');
        expect(event.from).toBe(ALICE);
        expect(event.vault).toBe(VAULT);
        expect(event.token).toBe('native');
        expect(event.amount).toBe(50_000_000n);
        expect(event.amountDecimal).toBe('5.0000000');
        expect(event.depositId).toBe(101);
        expect(event.contractId).toBe(VAULT);
        expect(event.txHash).toBe('e'.repeat(64));
        expect(event.ledger).toBe(98765);
        expect(event.ledgerClosedAt).toBe('2026-11-24T12:00:00Z');
      }
    });

    it('decodes deposit event with raw i128 ScVal amount value', () => {
      const raw = createRawEvent(
        [
          xdr.ScVal.scvSymbol('deposit'),
          new Address(ALICE).toScVal(),
          new Address(VAULT).toScVal(),
          xdr.ScVal.scvString(TOKEN_SAC),
        ],
        xdr.ScVal.scvI128(new xdr.Int128Parts({ lo: 125_000_000n, hi: 0n })),
      );

      const event = decodeAccensaEvent(raw);
      expect(isDepositEvent(event)).toBe(true);
      if (isDepositEvent(event)) {
        expect(event.amount).toBe(125_000_000n);
        expect(event.amountDecimal).toBe('12.5000000');
        expect(event.token).toBe(TOKEN_SAC);
      }
    });

    it('decodes deposit event with BigInt deposit_id converted to number or string', () => {
      const raw = createRawEvent(
        [
          xdr.ScVal.scvSymbol('deposit'),
          new Address(ALICE).toScVal(),
          new Address(VAULT).toScVal(),
        ],
        nativeToScVal({
          amount: 10_000_000n,
          deposit_id: 9007199254740992n, // Greater than MAX_SAFE_INTEGER
        }),
      );

      const event = decodeAccensaEvent(raw);
      expect(isDepositEvent(event)).toBe(true);
      if (isDepositEvent(event)) {
        expect(event.depositId).toBe('9007199254740992');
      }
    });
  });

  describe('RefundEvent deserialization', () => {
    it('decodes complete refund event with paymentId and reason', () => {
      const raw = createRawEvent(
        [xdr.ScVal.scvSymbol('refund'), new Address(VAULT).toScVal(), new Address(BOB).toScVal()],
        nativeToScVal({
          amount: 35_000_000n,
          token: TOKEN_SAC,
          payment_id: 'order_receipt_441',
          reason: 'Customer initiated return within warranty window',
        }),
      );

      const event = decodeAccensaEvent(raw);
      expect(isRefundEvent(event)).toBe(true);

      if (isRefundEvent(event)) {
        expect(event.type).toBe('refund');
        expect(event.from).toBe(VAULT);
        expect(event.to).toBe(BOB);
        expect(event.token).toBe(TOKEN_SAC);
        expect(event.amount).toBe(35_000_000n);
        expect(event.amountDecimal).toBe('3.5000000');
        expect(event.paymentId).toBe('order_receipt_441');
        expect(event.reason).toBe('Customer initiated return within warranty window');
      }
    });

    it('falls back to default token "native" when token is omitted', () => {
      const raw = createRawEvent(
        [xdr.ScVal.scvSymbol('refund'), new Address(VAULT).toScVal(), new Address(BOB).toScVal()],
        nativeToScVal({
          amount: 7_000_000n,
        }),
      );

      const event = decodeAccensaEvent(raw);
      expect(isRefundEvent(event)).toBe(true);
      if (isRefundEvent(event)) {
        expect(event.token).toBe('native');
        expect(event.amountDecimal).toBe('0.7000000');
      }
    });
  });

  describe('DisputeEvent deserialization', () => {
    it.each([
      ['initiated', 'initiated'],
      ['challenged', 'challenged'],
      ['resolved', 'resolved'],
      ['expired', 'expired'],
      ['canceled', 'canceled'],
      ['UNKNOWN_STATUS', 'initiated'], // fallback to 'initiated'
    ] as const)('decodes dispute event with status "%s"', (rawStatus, expectedStatus) => {
      const raw = createRawEvent(
        [
          xdr.ScVal.scvSymbol('dispute'),
          xdr.ScVal.scvString('disp-channel-1234'),
          new Address(ALICE).toScVal(),
          new Address(BOB).toScVal(),
        ],
        nativeToScVal({
          amount: 15_000_000n,
          status: rawStatus,
          timeout_ledger: 25000,
          reason: 'Escrow release signature timeout',
        }),
      );

      const event = decodeAccensaEvent(raw);
      expect(isDisputeEvent(event)).toBe(true);

      if (isDisputeEvent(event)) {
        expect(event.type).toBe('dispute');
        expect(event.disputeId).toBe('disp-channel-1234');
        expect(event.claimant).toBe(ALICE);
        expect(event.respondent).toBe(BOB);
        expect(event.amount).toBe(15_000_000n);
        expect(event.amountDecimal).toBe('1.5000000');
        expect(event.status).toBe(expectedStatus);
        expect(event.timeoutLedger).toBe(25000);
        expect(event.reason).toBe('Escrow release signature timeout');
      }
    });

    it('decodes dispute event with binary disputeId converted to hex string', () => {
      const binaryId = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const raw = createRawEvent(
        [
          xdr.ScVal.scvSymbol('dispute'),
          xdr.ScVal.scvBytes(binaryId),
          new Address(ALICE).toScVal(),
        ],
        nativeToScVal({
          amount: 20_000_000n,
        }),
      );

      const event = decodeAccensaEvent(raw);
      expect(isDisputeEvent(event)).toBe(true);
      if (isDisputeEvent(event)) {
        expect(event.disputeId).toBe('deadbeef');
      }
    });
  });

  describe('AnchorEvent deserialization', () => {
    it('decodes anchor event with standard symbol "anchor"', () => {
      const rawRoot = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
      const raw = createRawEvent(
        [xdr.ScVal.scvSymbol('anchor'), new Address(ALICE).toScVal(), xdr.ScVal.scvU32(42)],
        nativeToScVal({
          root: rawRoot,
          count: 250,
          period_start: 1700000000,
          period_end: 1700003600,
        }),
      );

      const event = decodeAccensaEvent(raw);
      expect(isAnchorEvent(event)).toBe(true);

      if (isAnchorEvent(event)) {
        expect(event.type).toBe('anchor');
        expect(event.merchant).toBe(ALICE);
        expect(event.batchId).toBe(42);
        expect(event.root).toBe(rawRoot);
        expect(event.count).toBe(250);
        expect(event.periodStart).toBe(1700000000);
        expect(event.periodEnd).toBe(1700003600);
      }
    });

    it('decodes anchor event with alternate symbol "batch_anchored"', () => {
      const rawRoot = new Uint8Array(32).fill(0xab);
      const hexRoot = 'ab'.repeat(32);
      const raw = createRawEvent(
        [xdr.ScVal.scvSymbol('batch_anchored'), new Address(ALICE).toScVal(), xdr.ScVal.scvU32(99)],
        nativeToScVal({
          merkle_root: hexRoot,
          leaf_count: 500,
          window_start: 1700010000,
          window_end: 1700020000,
        }),
      );

      const event = decodeAccensaEvent(raw);
      expect(isAnchorEvent(event)).toBe(true);
      if (isAnchorEvent(event)) {
        expect(event.batchId).toBe(99);
        expect(event.root).toBe(hexRoot);
        expect(event.count).toBe(500);
        expect(event.periodStart).toBe(1700010000);
        expect(event.periodEnd).toBe(1700020000);
      }
    });
  });

  describe('MultisigEvent deserialization', () => {
    it.each([
      ['proposed', 'proposed'],
      ['approved', 'approved'],
      ['executed', 'executed'],
      ['revoked', 'revoked'],
      ['UNKNOWN_OP', 'proposed'], // fallback
    ] as const)('decodes multisig event operation "%s"', (rawOp, expectedOp) => {
      const raw = createRawEvent(
        [
          xdr.ScVal.scvSymbol('multisig'),
          xdr.ScVal.scvSymbol(rawOp),
          xdr.ScVal.scvString('proposal-alpha-9'),
          new Address(ALICE).toScVal(),
        ],
        nativeToScVal({
          signers: [ALICE, BOB],
          threshold: 2,
          target: VAULT,
        }),
      );

      const event = decodeAccensaEvent(raw);
      expect(isMultisigEvent(event)).toBe(true);

      if (isMultisigEvent(event)) {
        expect(event.type).toBe('multisig');
        expect(event.operation).toBe(expectedOp);
        expect(event.proposalId).toBe('proposal-alpha-9');
        expect(event.signer).toBe(ALICE);
        expect(event.signers).toEqual([ALICE, BOB]);
        expect(event.threshold).toBe(2);
        expect(event.target).toBe(VAULT);
      }
    });
  });

  describe('Type Guards & matchAccensaEvent Exhaustive Matcher', () => {
    const deposit: DepositEvent = {
      contractId: VAULT,
      type: 'deposit',
      txHash: '1'.repeat(64),
      ledger: 100,
      ledgerClosedAt: '2026-11-24T12:00:00Z',
      from: ALICE,
      vault: VAULT,
      token: 'native',
      amount: 10_000_000n,
      amountDecimal: '1.0000000',
    };

    const refund: RefundEvent = {
      contractId: VAULT,
      type: 'refund',
      txHash: '2'.repeat(64),
      ledger: 101,
      ledgerClosedAt: '2026-11-24T12:00:00Z',
      from: VAULT,
      to: BOB,
      token: 'native',
      amount: 5_000_000n,
      amountDecimal: '0.5000000',
    };

    const dispute: DisputeEvent = {
      contractId: VAULT,
      type: 'dispute',
      txHash: '3'.repeat(64),
      ledger: 102,
      ledgerClosedAt: '2026-11-24T12:00:00Z',
      disputeId: 'disp-01',
      claimant: ALICE,
      status: 'initiated',
    };

    const anchor: AnchorEvent = {
      contractId: VAULT,
      type: 'anchor',
      txHash: '4'.repeat(64),
      ledger: 103,
      ledgerClosedAt: '2026-11-24T12:00:00Z',
      merchant: ALICE,
      batchId: 1,
      root: 'ff'.repeat(32),
      count: 10,
      periodStart: 1000,
      periodEnd: 2000,
    };

    const multisig: MultisigEvent = {
      contractId: VAULT,
      type: 'multisig',
      txHash: '5'.repeat(64),
      ledger: 104,
      ledgerClosedAt: '2026-11-24T12:00:00Z',
      operation: 'executed',
      proposalId: 'prop-77',
      signer: BOB,
    };

    it('type guards properly distinguish event types', () => {
      expect(isDepositEvent(deposit)).toBe(true);
      expect(isDepositEvent(refund)).toBe(false);

      expect(isRefundEvent(refund)).toBe(true);
      expect(isRefundEvent(dispute)).toBe(false);

      expect(isDisputeEvent(dispute)).toBe(true);
      expect(isDisputeEvent(anchor)).toBe(false);

      expect(isAnchorEvent(anchor)).toBe(true);
      expect(isAnchorEvent(multisig)).toBe(false);

      expect(isMultisigEvent(multisig)).toBe(true);
      expect(isMultisigEvent(deposit)).toBe(false);
    });

    it('matchAccensaEvent routes every event variant to its handler', () => {
      const events: AccensaEvent[] = [deposit, refund, dispute, anchor, multisig];
      const results = events.map((ev) =>
        matchAccensaEvent(ev, {
          deposit: (e) => `handled:deposit:${e.from}`,
          refund: (e) => `handled:refund:${e.to}`,
          dispute: (e) => `handled:dispute:${e.disputeId}`,
          anchor: (e) => `handled:anchor:${e.batchId}`,
          multisig: (e) => `handled:multisig:${e.operation}`,
        }),
      );

      expect(results).toEqual([
        `handled:deposit:${ALICE}`,
        `handled:refund:${BOB}`,
        'handled:dispute:disp-01',
        'handled:anchor:1',
        'handled:multisig:executed',
      ]);
    });
  });

  describe('Topic Filters', () => {
    it('produces valid base64 XDR encoded ScVal symbols matching expected event names', () => {
      const filters = {
        deposit: depositTopicFilter(),
        refund: refundTopicFilter(),
        dispute: disputeTopicFilter(),
        anchor: anchorTopicFilter(),
        multisig: multisigTopicFilter(),
      };

      for (const [name, filterBase64] of Object.entries(filters)) {
        expect(typeof filterBase64).toBe('string');
        const parsed = xdr.ScVal.fromXDR(filterBase64, 'base64');
        expect(parsed.switch()).toBe(xdr.ScValType.scvSymbol());
        expect(parsed.sym().toString()).toBe(name);
      }
    });
  });

  describe('Defensive & Error Handling Paths', () => {
    it('tryDecodeAccensaEvent returns null on non-object, null, or undefined', () => {
      expect(tryDecodeAccensaEvent(null)).toBeNull();
      expect(tryDecodeAccensaEvent(undefined)).toBeNull();
      expect(tryDecodeAccensaEvent('string')).toBeNull();
      expect(tryDecodeAccensaEvent(12345)).toBeNull();
    });

    it('tryDecodeAccensaEvent returns null when topic array is missing or empty', () => {
      expect(tryDecodeAccensaEvent({})).toBeNull();
      expect(tryDecodeAccensaEvent({ topic: [] })).toBeNull();
    });

    it('tryDecodeAccensaEvent returns null for unrecognized event topics (e.g. "transfer")', () => {
      const raw = createRawEvent(
        [xdr.ScVal.scvSymbol('transfer'), new Address(ALICE).toScVal()],
        xdr.ScVal.scvU32(100),
      );
      expect(tryDecodeAccensaEvent(raw)).toBeNull();
    });

    it('tryDecodeAccensaEvent returns null when required payload fields are missing', () => {
      // Deposit missing amount and from
      const malformedDeposit = createRawEvent([xdr.ScVal.scvSymbol('deposit')], nativeToScVal({}));
      expect(tryDecodeAccensaEvent(malformedDeposit)).toBeNull();

      // Anchor missing root and count
      const malformedAnchor = createRawEvent(
        [xdr.ScVal.scvSymbol('anchor')],
        nativeToScVal({ batch_id: 1 }),
      );
      expect(tryDecodeAccensaEvent(malformedAnchor)).toBeNull();
    });

    it('decodeAccensaEvent throws EventDecodeError with "invalid_payload" on null or non-object input', () => {
      expect(() => decodeAccensaEvent(null)).toThrow(EventDecodeError);
      try {
        decodeAccensaEvent(null);
      } catch (err) {
        expect(err).toBeInstanceOf(EventDecodeError);
        expect((err as EventDecodeError).code).toBe('invalid_payload');
        expect((err as EventDecodeError).raw).toBeNull();
      }
    });

    it('decodeAccensaEvent throws EventDecodeError with "unrecognized_event" on unrecognized topics', () => {
      const unknownEvent = createRawEvent([xdr.ScVal.scvSymbol('unknown_topic_foo')], {});
      expect(() => decodeAccensaEvent(unknownEvent)).toThrow(EventDecodeError);

      try {
        decodeAccensaEvent(unknownEvent);
      } catch (err) {
        expect(err).toBeInstanceOf(EventDecodeError);
        expect((err as EventDecodeError).code).toBe('unrecognized_event');
        expect((err as EventDecodeError).message).toContain('unknown_topic_foo');
      }
    });
  });
});
