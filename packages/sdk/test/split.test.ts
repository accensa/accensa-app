import { describe, it, expect } from 'vitest';
import {
  calculateSplitPayment,
  validateSplitTotals,
  suggestOptimalSplit,
  buildSplitPaymentTransaction,
  buildSplitAuthEntries,
  applySlippageTolerance,
  DEFAULT_USDC_ISSUER,
} from '../src/payment/split';
import { Networks } from '@stellar/stellar-sdk';

const CUSTOMER_ADDRESS = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const MERCHANT_ADDRESS = 'GBKNGF67M4FBWNCNIFR4LTFXHZD5RDUSMQ5YJL4R7R7N7OXOWLIEMVYV';
const TESTNET_PASSPHRASE = Networks.TESTNET;

describe('Split Tender Payments SDK', () => {
  const defaultRates = {
    xlmUsdRate: 0.1, // 1 XLM = $0.10 USD (so $10 USD = 100 XLM)
    usdcUsdRate: 1.0, // 1 USDC = $1.00 USD
  };

  describe('calculateSplitPayment', () => {
    it('allocates 100% to USDC when usdcPercentage is 100', () => {
      const result = calculateSplitPayment({
        totalCheckoutUsd: 50.0,
        usdcPercentage: 100,
        rates: defaultRates,
      });

      expect(result.totalCheckoutUsd).toBe(50.0);
      expect(result.coveredUsd).toBe(50.0);
      expect(result.isFullyCovered).toBe(true);

      expect(result.usdcAllocation.percentage).toBe(100);
      expect(result.usdcAllocation.fiatValueUsd).toBe(50.0);
      expect(result.usdcAllocation.amount).toBe('50.0000000');
      expect(result.usdcAllocation.amountStroops).toBe(500_000_000n);

      expect(result.xlmAllocation.percentage).toBe(0);
      expect(result.xlmAllocation.fiatValueUsd).toBe(0);
      expect(result.xlmAllocation.amount).toBe('0.0000000');
      expect(result.xlmAllocation.amountStroops).toBe(0n);
    });

    it('allocates 100% to XLM when usdcPercentage is 0', () => {
      const result = calculateSplitPayment({
        totalCheckoutUsd: 50.0,
        usdcPercentage: 0,
        rates: defaultRates,
      });

      expect(result.totalCheckoutUsd).toBe(50.0);
      expect(result.coveredUsd).toBe(50.0);
      expect(result.isFullyCovered).toBe(true);

      expect(result.usdcAllocation.percentage).toBe(0);
      expect(result.usdcAllocation.fiatValueUsd).toBe(0);
      expect(result.usdcAllocation.amount).toBe('0.0000000');
      expect(result.usdcAllocation.amountStroops).toBe(0n);

      expect(result.xlmAllocation.percentage).toBe(100);
      expect(result.xlmAllocation.fiatValueUsd).toBe(50.0);
      // At $0.10 per XLM, $50 = 500 XLM
      expect(result.xlmAllocation.amount).toBe('500.0000000');
      expect(result.xlmAllocation.amountStroops).toBe(5_000_000_000n);
    });

    it('accurately divides a 50/50 split and validates combined sums', () => {
      const result = calculateSplitPayment({
        totalCheckoutUsd: 100.0,
        usdcPercentage: 50,
        rates: defaultRates,
      });

      expect(result.usdcAllocation.fiatValueUsd).toBe(50.0);
      expect(result.xlmAllocation.fiatValueUsd).toBe(50.0);
      expect(result.coveredUsd).toBe(100.0);
      expect(result.isFullyCovered).toBe(true);

      expect(result.usdcAllocation.amount).toBe('50.0000000');
      expect(result.xlmAllocation.amount).toBe('500.0000000');

      expect(validateSplitTotals(result.allocations, 100.0)).toBe(true);
    });

    it('handles arbitrary split percentages (e.g. 73.5% USDC / 26.5% XLM)', () => {
      const result = calculateSplitPayment({
        totalCheckoutUsd: 200.0,
        usdcPercentage: 73.5,
        rates: defaultRates,
      });

      expect(result.usdcAllocation.fiatValueUsd).toBe(147.0);
      expect(result.xlmAllocation.fiatValueUsd).toBe(53.0);
      expect(result.coveredUsd).toBe(200.0);
      expect(result.isFullyCovered).toBe(true);

      expect(result.usdcAllocation.amount).toBe('147.0000000');
      expect(result.xlmAllocation.amount).toBe('530.0000000');
      expect(validateSplitTotals(result.allocations, 200.0)).toBe(true);
    });

    it('clamps negative percentages to 0 and >100 to 100', () => {
      const lowResult = calculateSplitPayment({
        totalCheckoutUsd: 10.0,
        usdcPercentage: -25,
        rates: defaultRates,
      });
      expect(lowResult.usdcAllocation.percentage).toBe(0);
      expect(lowResult.xlmAllocation.percentage).toBe(100);

      const highResult = calculateSplitPayment({
        totalCheckoutUsd: 10.0,
        usdcPercentage: 150,
        rates: defaultRates,
      });
      expect(highResult.usdcAllocation.percentage).toBe(100);
      expect(highResult.xlmAllocation.percentage).toBe(0);
    });

    it('computes slippage protection bounds on XLM deduction', () => {
      const result = calculateSplitPayment({
        totalCheckoutUsd: 50.0,
        usdcPercentage: 0,
        rates: defaultRates, // 500 XLM base
        slippageTolerancePercent: 2.0, // 2% max slippage
      });

      // 500 XLM * 1.02 = 510 XLM
      expect(result.maxXlmDeductionWithSlippage).toBe('510.0000000');
      expect(result.maxXlmStroopsWithSlippage).toBe(5_100_000_000n);
    });

    it('validates customer balances and flags insufficient funds', () => {
      const affordable = calculateSplitPayment({
        totalCheckoutUsd: 50.0,
        usdcPercentage: 50,
        rates: defaultRates,
        customerBalances: {
          usdc: '30.0', // needs 25
          xlm: '300.0', // needs 250
        },
      });
      expect(affordable.canAfford).toBe(true);
      expect(affordable.insufficientTokens).toEqual([]);

      const brokeUsdc = calculateSplitPayment({
        totalCheckoutUsd: 50.0,
        usdcPercentage: 50,
        rates: defaultRates,
        customerBalances: {
          usdc: '10.0', // needs 25 -> insufficient
          xlm: '300.0',
        },
      });
      expect(brokeUsdc.canAfford).toBe(false);
      expect(brokeUsdc.insufficientTokens).toContain('USDC');

      const brokeXlm = calculateSplitPayment({
        totalCheckoutUsd: 50.0,
        usdcPercentage: 50,
        rates: defaultRates,
        customerBalances: {
          usdc: '50.0',
          xlm: '100.0', // needs 250 -> insufficient
        },
      });
      expect(brokeXlm.canAfford).toBe(false);
      expect(brokeXlm.insufficientTokens).toContain('XLM');
    });
  });

  describe('suggestOptimalSplit', () => {
    it('suggests 100% USDC if customer has enough USDC for the entire checkout', () => {
      expect(suggestOptimalSplit(50.0, 100.0)).toBe(100);
      expect(suggestOptimalSplit(50.0, 50.0)).toBe(100);
    });

    it('suggests exact percentage when customer has partial USDC', () => {
      // $25 USDC out of $100 checkout = 25%
      expect(suggestOptimalSplit(100.0, 25.0)).toBe(25);
      // $10 USDC out of $50 checkout = 20%
      expect(suggestOptimalSplit(50.0, 10.0)).toBe(20);
    });

    it('suggests 0% if customer has 0 USDC', () => {
      expect(suggestOptimalSplit(50.0, 0)).toBe(0);
    });
  });

  describe('buildSplitPaymentTransaction', () => {
    it('builds an atomic Stellar transaction with both payment operations', () => {
      const splitResult = calculateSplitPayment({
        totalCheckoutUsd: 100.0,
        usdcPercentage: 60, // $60 USDC, $40 XLM
        rates: defaultRates,
      });

      const tx = buildSplitPaymentTransaction({
        sourceAccount: CUSTOMER_ADDRESS,
        merchantAccount: MERCHANT_ADDRESS,
        sequence: '1001',
        splitResult,
        networkPassphrase: TESTNET_PASSPHRASE,
      });

      expect(tx).toBeDefined();
      expect(tx.operations.length).toBe(2);

      const [op1, op2] = tx.operations;

      // First operation: USDC payment
      expect(op1.type).toBe('payment');
      if (op1.type === 'payment') {
        expect(op1.destination).toBe(MERCHANT_ADDRESS);
        expect(op1.amount).toBe('60.0000000');
        expect(op1.asset.code).toBe('USDC');
        expect(op1.asset.issuer).toBe(DEFAULT_USDC_ISSUER);
      }

      // Second operation: XLM payment
      expect(op2.type).toBe('payment');
      if (op2.type === 'payment') {
        expect(op2.destination).toBe(MERCHANT_ADDRESS);
        expect(op2.amount).toBe('400.0000000');
        expect(op2.asset.isNative()).toBe(true);
      }
    });

    it('builds transaction with single payment operation when 100% USDC', () => {
      const splitResult = calculateSplitPayment({
        totalCheckoutUsd: 50.0,
        usdcPercentage: 100,
        rates: defaultRates,
      });

      const tx = buildSplitPaymentTransaction({
        sourceAccount: CUSTOMER_ADDRESS,
        merchantAccount: MERCHANT_ADDRESS,
        sequence: '1002',
        splitResult,
        networkPassphrase: TESTNET_PASSPHRASE,
      });

      expect(tx.operations.length).toBe(1);
      expect(tx.operations[0].type).toBe('payment');
      if (tx.operations[0].type === 'payment') {
        expect(tx.operations[0].asset.code).toBe('USDC');
        expect(tx.operations[0].amount).toBe('50.0000000');
      }
    });

    it('builds transaction with single native payment operation when 100% XLM', () => {
      const splitResult = calculateSplitPayment({
        totalCheckoutUsd: 50.0,
        usdcPercentage: 0,
        rates: defaultRates,
      });

      const tx = buildSplitPaymentTransaction({
        sourceAccount: CUSTOMER_ADDRESS,
        merchantAccount: MERCHANT_ADDRESS,
        sequence: '1003',
        splitResult,
        networkPassphrase: TESTNET_PASSPHRASE,
      });

      expect(tx.operations.length).toBe(1);
      expect(tx.operations[0].type).toBe('payment');
      if (tx.operations[0].type === 'payment') {
        expect(tx.operations[0].asset.isNative()).toBe(true);
        expect(tx.operations[0].amount).toBe('500.0000000');
      }
    });
  });

  describe('buildSplitAuthEntries', () => {
    it('generates paired authorization entries with slippage limits', () => {
      const splitResult = calculateSplitPayment({
        totalCheckoutUsd: 100.0,
        usdcPercentage: 50,
        rates: defaultRates,
        slippageTolerancePercent: 1.5,
      });

      const entries = buildSplitAuthEntries(CUSTOMER_ADDRESS, MERCHANT_ADDRESS, splitResult);

      expect(entries.length).toBe(2);
      expect(entries[0].symbol).toBe('USDC');
      expect(entries[0].amountDecimal).toBe('50.0000000');
      expect(entries[0].amountStroops).toBe(500_000_000n);

      expect(entries[1].symbol).toBe('XLM');
      expect(entries[1].amountDecimal).toBe('500.0000000');
      expect(entries[1].amountStroops).toBe(5_000_000_000n);
      expect(entries[1].maxAmountWithSlippage).toBe('507.5000000');
    });
  });

  describe('applySlippageTolerance', () => {
    it('computes maximum payment with slippage', () => {
      expect(applySlippageTolerance(100, 1.0, 'maximum_pay')).toBe('101.0000000');
      expect(applySlippageTolerance('200', 2.5, 'maximum_pay')).toBe('205.0000000');
    });

    it('computes minimum receive with slippage', () => {
      expect(applySlippageTolerance(100, 1.0, 'minimum_receive')).toBe('99.0000000');
      expect(applySlippageTolerance('200', 5.0, 'minimum_receive')).toBe('190.0000000');
    });
  });
});
