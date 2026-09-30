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
} from '../src/events';

const ALICE = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const BOB = 'GBKNGF67M4FBWNCNIFR4LTFXHZD5RDUSMQ5YJL4R7R7N7OXOWLIEMVYV';
const VAULT = 'CCMBM44EJUGD52G4LSMGHSXMAH2KSAQZX7VOYY4TTBF5BK4D7M4IHRQA';

function createRawEvent(topics: xdr.ScVal[], value: xdr.ScVal, overrides = {}) {
  return {
    id: '0000000001',
    contractId: VAULT,
    txHash: 'a'.repeat(64),
    ledger: 12345,
    ledgerClosedAt: '2026-09-27T00:00:00Z',
    topic: topics.map((t) => t.toXDR('base64')),
    value: value.toXDR('base64'),
    ...overrides,
  };
}

describe('Soroban Contract Events Types & Decoders (#421)', () => {
  describe('DepositEvent decoding', () => {
    it('decodes a valid DepositEvent from Soroban RPC fixture payload', () => {
      const raw = createRawEvent(
        [
          xdr.ScVal.scvSymbol('deposit'),
          new Address(ALICE).toScVal(),
          new Address(VAULT).toScVal(),
        ],
        nativeToScVal({
          amount: 50_000_000n, // 5.0 XLM/USDC
          token: 'native',
          deposit_id: 101,
        }),
      );

      const event = decodeAccensaEvent(raw);
      expect(isDepositEvent(event)).toBe(true);

      if (isDepositEvent(event)) {
        expect(event.type).toBe('deposit');
        expect(event.from).toBe(ALICE);
        expect(event.vault).toBe(VAULT);
        expect(event.amount).toBe(50_000_000n);
        expect(event.amountDecimal).toBe('5.0000000');
        expect(event.token).toBe('native');
        expect(event.depositId).toBe(101);
        expect(event.txHash).toBe('a'.repeat(64));
        expect(event.ledger).toBe(12345);
      }
    });

    it('handles bare i128 ScVal value with token topic', () => {
      const raw = createRawEvent(
        [
          xdr.ScVal.scvSymbol('deposit'),
          new Address(ALICE).toScVal(),
          new Address(VAULT).toScVal(),
          xdr.ScVal.scvString('USDC:GA...'),
        ],
        xdr.ScVal.scvI128(new xdr.Int128Parts({ lo: 100_000_000n, hi: 0n })),
      );

      const event = decodeAccensaEvent(raw);
      expect(isDepositEvent(event)).toBe(true);
      if (isDepositEvent(event)) {
        expect(event.amount).toBe(100_000_000n);
        expect(event.amountDecimal).toBe('10.0000000');
        expect(event.token).toBe('USDC:GA...');
      }
    });
  });

  describe('RefundEvent decoding', () => {
    it('decodes a valid RefundEvent with paymentId and reason', () => {
      const raw = createRawEvent(
        [xdr.ScVal.scvSymbol('refund'), new Address(VAULT).toScVal(), new Address(BOB).toScVal()],
        nativeToScVal({
          amount: 25_000_000n,
          token: 'USDC:GA...',
          payment_id: 'pay-order-889',
          reason: 'Duplicate payment refund',
        }),
      );

      const event = decodeAccensaEvent(raw);
      expect(isRefundEvent(event)).toBe(true);

      if (isRefundEvent(event)) {
        expect(event.type).toBe('refund');
        expect(event.from).toBe(VAULT);
        expect(event.to).toBe(BOB);
        expect(event.amount).toBe(25_000_000n);
        expect(event.amountDecimal).toBe('2.5000000');
        expect(event.token).toBe('USDC:GA...');
        expect(event.paymentId).toBe('pay-order-889');
        expect(event.reason).toBe('Duplicate payment refund');
      }
    });
  });

  describe('DisputeEvent decoding', () => {
    it('decodes dispute lifecycle events and status', () => {
      const raw = createRawEvent(
        [
          xdr.ScVal.scvSymbol('dispute'),
          xdr.ScVal.scvString('channel-dispute-99'),
          new Address(BOB).toScVal(),
          new Address(ALICE).toScVal(),
        ],
        nativeToScVal({
          amount: 10_000_000n,
          status: 'initiated',
          timeout_ledger: 15000,
          reason: 'State discrepancy in channel closure',
        }),
      );

      const event = decodeAccensaEvent(raw);
      expect(isDisputeEvent(event)).toBe(true);

      if (isDisputeEvent(event)) {
        expect(event.type).toBe('dispute');
        expect(event.disputeId).toBe('channel-dispute-99');
        expect(event.claimant).toBe(BOB);
        expect(event.respondent).toBe(ALICE);
        expect(event.amount).toBe(10_000_000n);
        expect(event.amountDecimal).toBe('1.0000000');
        expect(event.status).toBe('initiated');
        expect(event.timeoutLedger).toBe(15000);
        expect(event.reason).toBe('State discrepancy in channel closure');
      }
    });

    it('decodes challenged and resolved dispute states', () => {
      const rawChallenged = createRawEvent(
        [xdr.ScVal.scvSymbol('dispute'), xdr.ScVal.scvString('disp-1'), new Address(BOB).toScVal()],
        nativeToScVal({ status: 'challenged' }),
      );
      const evChallenged = decodeAccensaEvent(rawChallenged) as DisputeEvent;
      expect(evChallenged.status).toBe('challenged');

      const rawResolved = createRawEvent(
        [xdr.ScVal.scvSymbol('dispute'), xdr.ScVal.scvString('disp-1'), new Address(BOB).toScVal()],
        nativeToScVal({ status: 'resolved' }),
      );
      const evResolved = decodeAccensaEvent(rawResolved) as DisputeEvent;
      expect(evResolved.status).toBe('resolved');
    });
  });

  describe('AnchorEvent decoding', () => {
    it('decodes a ReceiptAnchor batch anchored event', () => {
      const rootHex = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const rootBytes = Uint8Array.from(Buffer.from(rootHex, 'hex'));

      const raw = createRawEvent(
        [xdr.ScVal.scvSymbol('batch_anchored'), new Address(ALICE).toScVal(), xdr.ScVal.scvU32(42)],
        nativeToScVal({
          root: rootBytes,
          count: 100,
          period_start: 1700000000,
          period_end: 1700086400,
        }),
      );

      const event = decodeAccensaEvent(raw);
      expect(isAnchorEvent(event)).toBe(true);

      if (isAnchorEvent(event)) {
        expect(event.type).toBe('anchor');
        expect(event.merchant).toBe(ALICE);
        expect(event.batchId).toBe(42);
        expect(event.root).toBe(rootHex);
        expect(event.count).toBe(100);
        expect(event.periodStart).toBe(1700000000);
        expect(event.periodEnd).toBe(1700086400);
      }
    });
  });

  describe('MultisigEvent decoding', () => {
    it('decodes multisig proposal and approval operations', () => {
      const raw = createRawEvent(
        [
          xdr.ScVal.scvSymbol('multisig'),
          xdr.ScVal.scvSymbol('approved'),
          xdr.ScVal.scvU32(7),
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
        expect(event.operation).toBe('approved');
        expect(event.proposalId).toBe(7);
        expect(event.signer).toBe(ALICE);
        expect(event.signers).toEqual([ALICE, BOB]);
        expect(event.threshold).toBe(2);
        expect(event.target).toBe(VAULT);
      }
    });
  });

  describe('matchAccensaEvent exhaustive handling', () => {
    it('dispatches every event to its specific handler', () => {
      const depositEvent: DepositEvent = {
        contractId: VAULT,
        type: 'deposit',
        txHash: '1'.repeat(64),
        ledger: 100,
        ledgerClosedAt: '2026-09-27T00:00:00Z',
        from: ALICE,
        vault: VAULT,
        token: 'native',
        amount: 10_000_000n,
        amountDecimal: '1.0000000',
      };

      const refundEvent: RefundEvent = {
        contractId: VAULT,
        type: 'refund',
        txHash: '2'.repeat(64),
        ledger: 101,
        ledgerClosedAt: '2026-09-27T00:00:00Z',
        from: VAULT,
        to: BOB,
        token: 'native',
        amount: 5_000_000n,
        amountDecimal: '0.5000000',
      };

      const disputeEvent: DisputeEvent = {
        contractId: VAULT,
        type: 'dispute',
        txHash: '3'.repeat(64),
        ledger: 102,
        ledgerClosedAt: '2026-09-27T00:00:00Z',
        disputeId: 'disp-1',
        claimant: BOB,
        status: 'initiated',
      };

      const anchorEvent: AnchorEvent = {
        contractId: VAULT,
        type: 'anchor',
        txHash: '4'.repeat(64),
        ledger: 103,
        ledgerClosedAt: '2026-09-27T00:00:00Z',
        merchant: ALICE,
        batchId: 1,
        root: '0'.repeat(64),
        count: 10,
        periodStart: 1000,
        periodEnd: 2000,
      };

      const multisigEvent: MultisigEvent = {
        contractId: VAULT,
        type: 'multisig',
        txHash: '5'.repeat(64),
        ledger: 104,
        ledgerClosedAt: '2026-09-27T00:00:00Z',
        operation: 'executed',
        proposalId: 'prop-1',
        signer: ALICE,
      };

      const events: AccensaEvent[] = [
        depositEvent,
        refundEvent,
        disputeEvent,
        anchorEvent,
        multisigEvent,
      ];

      const handled = events.map((ev) =>
        matchAccensaEvent(ev, {
          deposit: (e) => `handled:deposit:${e.from}`,
          refund: (e) => `handled:refund:${e.to}`,
          dispute: (e) => `handled:dispute:${e.disputeId}`,
          anchor: (e) => `handled:anchor:${e.batchId}`,
          multisig: (e) => `handled:multisig:${e.operation}`,
        }),
      );

      expect(handled).toEqual([
        `handled:deposit:${ALICE}`,
        `handled:refund:${BOB}`,
        'handled:dispute:disp-1',
        'handled:anchor:1',
        'handled:multisig:executed',
      ]);
    });
  });

  describe('Defensive & failure path handling', () => {
    it('returns null on tryDecodeAccensaEvent for non-Accensa events (e.g. transfer)', () => {
      const nonAccensaEvent = createRawEvent(
        [xdr.ScVal.scvSymbol('transfer'), new Address(ALICE).toScVal(), new Address(BOB).toScVal()],
        xdr.ScVal.scvI128(new xdr.Int128Parts({ lo: 10_000_000n, hi: 0n })),
      );

      expect(tryDecodeAccensaEvent(nonAccensaEvent)).toBeNull();
    });

    it('returns null on tryDecodeAccensaEvent for null or empty payloads', () => {
      expect(tryDecodeAccensaEvent(null)).toBeNull();
      expect(tryDecodeAccensaEvent({})).toBeNull();
      expect(tryDecodeAccensaEvent({ topic: [] })).toBeNull();
    });

    it('throws EventDecodeError when decodeAccensaEvent fails', () => {
      const nonAccensaEvent = createRawEvent(
        [xdr.ScVal.scvSymbol('unsupported_event')],
        xdr.ScVal.scvU32(1),
      );

      expect(() => decodeAccensaEvent(nonAccensaEvent)).toThrow(EventDecodeError);
      expect(() => decodeAccensaEvent(null)).toThrow(EventDecodeError);

      try {
        decodeAccensaEvent(nonAccensaEvent);
      } catch (err) {
        expect(err).toBeInstanceOf(EventDecodeError);
        expect((err as EventDecodeError).code).toBe('unrecognized_event');
      }
    });
  });

  describe('Topic Filters', () => {
    it('generates valid Base64 XDR symbol topic filters', () => {
      const depositFilter = depositTopicFilter();
      const refundFilter = refundTopicFilter();
      const disputeFilter = disputeTopicFilter();
      const anchorFilter = anchorTopicFilter();
      const multisigFilter = multisigTopicFilter();

      expect(typeof depositFilter).toBe('string');
      expect(typeof refundFilter).toBe('string');
      expect(typeof disputeFilter).toBe('string');
      expect(typeof anchorFilter).toBe('string');
      expect(typeof multisigFilter).toBe('string');

      // Verify they decode back to expected symbols
      expect(xdr.ScVal.fromXDR(depositFilter, 'base64').sym().toString()).toBe('deposit');
      expect(xdr.ScVal.fromXDR(refundFilter, 'base64').sym().toString()).toBe('refund');
      expect(xdr.ScVal.fromXDR(disputeFilter, 'base64').sym().toString()).toBe('dispute');
      expect(xdr.ScVal.fromXDR(anchorFilter, 'base64').sym().toString()).toBe('anchor');
      expect(xdr.ScVal.fromXDR(multisigFilter, 'base64').sym().toString()).toBe('multisig');
    });
  });

  describe('TypeScript Generic Metadata Extensions', () => {
    interface CustomEventMeta {
      clientIp: string;
      internalAuditId: string;
    }

    it('allows strongly-typed custom metadata on events', () => {
      const customDeposit: DepositEvent<CustomEventMeta> = {
        contractId: VAULT,
        type: 'deposit',
        txHash: 'a'.repeat(64),
        ledger: 100,
        ledgerClosedAt: '2026-09-27T00:00:00Z',
        from: ALICE,
        vault: VAULT,
        token: 'native',
        amount: 10_000_000n,
        amountDecimal: '1.0000000',
        metadata: {
          clientIp: '127.0.0.1',
          internalAuditId: 'audit-999',
        },
      };

      expect(customDeposit.metadata?.clientIp).toBe('127.0.0.1');
      expect(customDeposit.metadata?.internalAuditId).toBe('audit-999');
    });
  });
});
