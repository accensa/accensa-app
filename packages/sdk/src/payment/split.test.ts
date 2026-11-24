import { describe, expect, it } from 'vitest';
import { Asset, Keypair, Networks, type Transaction } from '@stellar/stellar-sdk';
import {
  calculateSplitPayment,
  validateSplitTotals,
  suggestOptimalSplit,
  buildSplitPaymentTransaction,
  buildSplitAuthEntries,
  DEFAULT_USDC_ISSUER,
  type SplitCalculationParams,
  type SplitCalculationResult,
  type TokenAllocation,
} from './split';

const XLM_USD_RATE = 0.12;

/** Shape of the payment operations exposed on a built (unsubmitted) transaction. */
interface PaymentOperation {
  type: string;
  destination: string;
  asset: Asset;
  amount: string;
}

function calc(overrides: Partial<SplitCalculationParams> = {}): SplitCalculationResult {
  return calculateSplitPayment({
    totalCheckoutUsd: 100,
    usdcPercentage: 50,
    rates: { xlmUsdRate: XLM_USD_RATE },
    ...overrides,
  });
}

function paymentOperations(tx: Transaction): PaymentOperation[] {
  return tx.operations as unknown as PaymentOperation[];
}

function buildTransaction(
  splitResult: SplitCalculationResult,
  overrides: Partial<Parameters<typeof buildSplitPaymentTransaction>[0]> = {},
): Transaction {
  const source = Keypair.random().publicKey();
  const merchant = Keypair.random().publicKey();
  return buildSplitPaymentTransaction({
    sourceAccount: source,
    merchantAccount: merchant,
    sequence: '12345',
    splitResult,
    networkPassphrase: Networks.TESTNET,
    ...overrides,
  });
}

describe('calculateSplitPayment', () => {
  it('allocates the full total to USDC for a 100% USDC split', () => {
    const result = calc({ usdcPercentage: 100 });

    expect(result.usdcAllocation).toMatchObject({
      asset: `USDC:${DEFAULT_USDC_ISSUER}`,
      symbol: 'USDC',
      amount: '100.0000000',
      amountStroops: 1_000_000_000n,
      fiatValueUsd: 100,
      percentage: 100,
    });
    expect(result.xlmAllocation).toMatchObject({
      asset: 'native',
      symbol: 'XLM',
      amount: '0.0000000',
      amountStroops: 0n,
      fiatValueUsd: 0,
      percentage: 0,
    });
    expect(result.allocations).toHaveLength(2);
    expect(result.coveredUsd).toBe(100);
    expect(result.isFullyCovered).toBe(true);
    expect(result.maxXlmDeductionWithSlippage).toBe('0.0000000');
    expect(result.maxXlmStroopsWithSlippage).toBe(0n);
    expect(result.canAfford).toBe(true);
    expect(result.insufficientTokens).toEqual([]);
  });

  it('allocates the full total to XLM for a 0% USDC split', () => {
    const result = calc({ usdcPercentage: 0 });

    expect(result.usdcAllocation.amount).toBe('0.0000000');
    expect(result.usdcAllocation.amountStroops).toBe(0n);
    expect(result.usdcAllocation.percentage).toBe(0);
    expect(result.xlmAllocation).toMatchObject({
      amount: '833.3333333',
      amountStroops: 8_333_333_333n,
      fiatValueUsd: 100,
      percentage: 100,
    });
    expect(result.isFullyCovered).toBe(true);
  });

  it('splits a 50/50 allocation into stroop-precise token amounts', () => {
    const result = calc();

    expect(result.usdcAllocation.amountStroops).toBe(500_000_000n);
    expect(result.xlmAllocation.amountStroops).toBe(4_166_666_667n);
    expect(result.usdcAllocation.amount).toBe('50.0000000');
    expect(result.xlmAllocation.amount).toBe('416.6666667');
    expect(result.xlmAllocation.percentage).toBe(50);
    expect(result.coveredUsd).toBe(100);
    expect(result.effectiveRate).toBe(XLM_USD_RATE);
    expect(result.slippageTolerancePercent).toBe(1);
  });

  it('applies the default 1% slippage multiplier to the maximum XLM deduction', () => {
    const result = calc();

    expect(result.maxXlmDeductionWithSlippage).toBe('420.8333333');
    expect(result.maxXlmStroopsWithSlippage).toBe(4_208_333_333n);
    expect(result.maxXlmStroopsWithSlippage > result.xlmAllocation.amountStroops).toBe(true);
  });

  it('scales the XLM bound for a custom 2.5% slippage tolerance', () => {
    const result = calc({
      totalCheckoutUsd: 12,
      usdcPercentage: 0,
      slippageTolerancePercent: 2.5,
    });

    expect(result.xlmAllocation.amount).toBe('100.0000000');
    expect(result.xlmAllocation.amountStroops).toBe(1_000_000_000n);
    expect(result.slippageTolerancePercent).toBe(2.5);
    expect(result.maxXlmDeductionWithSlippage).toBe('102.5000000');
    expect(result.maxXlmStroopsWithSlippage).toBe(1_025_000_000n);
  });

  it('flags both tokens when both customer balances are deficient', () => {
    const result = calc({ customerBalances: { usdc: '10', xlm: '100' } });

    expect(result.canAfford).toBe(false);
    expect(result.insufficientTokens).toEqual(['USDC', 'XLM']);
    expect(result.usdcAllocation.balance).toBe('10.0000000');
    expect(result.usdcAllocation.balanceStroops).toBe(100_000_000n);
    expect(result.xlmAllocation.balanceStroops).toBe(1_000_000_000n);
  });

  it('flags only the token whose balance is short', () => {
    const result = calc({ customerBalances: { usdc: '500', xlm: '100' } });

    expect(result.insufficientTokens).toEqual(['XLM']);
    expect(result.canAfford).toBe(false);
  });

  it('marks the XLM allocation insufficient when the balance covers it but not slippage', () => {
    const result = calc({ customerBalances: { usdc: '50', xlm: '416.6666667' } });

    expect(result.canAfford).toBe(false);
    expect(result.insufficientTokens).toEqual(['XLM']);
  });

  it('reports affordability when balances cover the split including slippage', () => {
    const result = calc({ customerBalances: { usdc: '50', xlm: '430' } });

    expect(result.canAfford).toBe(true);
    expect(result.insufficientTokens).toEqual([]);
    expect(result.xlmAllocation.balance).toBe('430.0000000');
  });

  it('clamps a total of zero to an empty but fully covered split', () => {
    const result = calc({ totalCheckoutUsd: 0 });

    expect(result.totalCheckoutUsd).toBe(0);
    expect(result.usdcAllocation.amountStroops).toBe(0n);
    expect(result.xlmAllocation.amountStroops).toBe(0n);
    expect(result.coveredUsd).toBe(0);
    expect(result.isFullyCovered).toBe(true);
    expect(result.canAfford).toBe(true);
  });

  it('clamps a negative total to zero', () => {
    const result = calc({ totalCheckoutUsd: -25 });

    expect(result.totalCheckoutUsd).toBe(0);
    expect(result.coveredUsd).toBe(0);
    expect(result.isFullyCovered).toBe(true);
    expect(result.usdcAllocation.fiatValueUsd).toBe(0);
    expect(result.xlmAllocation.fiatValueUsd).toBe(0);
  });

  it('clamps out-of-range USDC percentages into 0..100', () => {
    const over = calc({ usdcPercentage: 150 });
    expect(over.usdcAllocation.percentage).toBe(100);
    expect(over.xlmAllocation.percentage).toBe(0);

    const under = calc({ usdcPercentage: -20 });
    expect(under.usdcAllocation.percentage).toBe(0);
    expect(under.xlmAllocation.percentage).toBe(100);
  });

  it('falls back to sane rates when provided rates are non-positive', () => {
    const result = calc({ rates: { xlmUsdRate: 0, usdcUsdRate: 0 } });

    expect(result.effectiveRate).toBe(0.1);
    expect(result.usdcAllocation.amount).toBe('50.0000000');
    expect(result.xlmAllocation.amount).toBe('500.0000000');
  });

  it('honours a custom USDC issuer on the USDC allocation asset id', () => {
    const issuer = Keypair.random().publicKey();
    const result = calc({ usdcIssuer: issuer });

    expect(result.usdcAllocation.asset).toBe(`USDC:${issuer}`);
  });
});

describe('validateSplitTotals', () => {
  const allocations = calc().allocations;

  it('accepts allocations whose USD values sum to the required total', () => {
    expect(validateSplitTotals(allocations, 100)).toBe(true);
  });

  it('accepts deviations within the default precision tolerance', () => {
    expect(validateSplitTotals(allocations, 100.00005)).toBe(true);
  });

  it('rejects deviations beyond the default precision tolerance', () => {
    expect(validateSplitTotals(allocations, 100.0002)).toBe(false);
  });

  it('respects an explicit custom tolerance', () => {
    expect(validateSplitTotals(allocations, 100.5, 1)).toBe(true);
    expect(validateSplitTotals(allocations, 100.5, 0.1)).toBe(false);
  });

  it('rejects an empty allocation set against a non-zero total', () => {
    expect(validateSplitTotals([], 100)).toBe(false);
    expect(validateSplitTotals([], 0)).toBe(true);
  });

  it('ignores the token amounts and sums only the fiat USD values', () => {
    const inflated: TokenAllocation[] = allocations.map((allocation) => ({
      ...allocation,
      amountStroops: allocation.amountStroops * 2n,
    }));

    expect(validateSplitTotals(inflated, 100)).toBe(true);
  });
});

describe('suggestOptimalSplit', () => {
  it('returns 100 when the customer can cover the total in USDC', () => {
    expect(suggestOptimalSplit(100, 100)).toBe(100);
    expect(suggestOptimalSplit(100, 250)).toBe(100);
  });

  it('returns 0 when the customer has no USDC', () => {
    expect(suggestOptimalSplit(100, 0)).toBe(0);
  });

  it('returns the maximum affordable USDC coverage as a percentage', () => {
    expect(suggestOptimalSplit(100, 25)).toBe(25);
    expect(suggestOptimalSplit(200, 50)).toBe(25);
  });

  it('rounds the affordable percentage to two decimals', () => {
    expect(suggestOptimalSplit(100, 33.333)).toBe(33.33);
    expect(suggestOptimalSplit(3, 1)).toBe(33.33);
  });

  it('falls back to 100 for zero or negative totals', () => {
    expect(suggestOptimalSplit(0, 10)).toBe(100);
    expect(suggestOptimalSplit(-5, 10)).toBe(100);
  });

  it('clamps negative balances to 0', () => {
    expect(suggestOptimalSplit(100, -10)).toBe(0);
  });
});

describe('buildSplitPaymentTransaction', () => {
  const merchant = Keypair.random().publicKey();

  it('builds an atomic transaction with a USDC and an XLM payment for a 50/50 split', () => {
    const split = calc();
    const source = Keypair.random().publicKey();
    const tx = buildTransaction(split, { merchantAccount: merchant, sourceAccount: source });
    const operations = paymentOperations(tx);

    expect(operations).toHaveLength(2);
    expect(tx.source).toBe(source);
    expect(operations[0]).toMatchObject({
      type: 'payment',
      destination: merchant,
      amount: '50.0000000',
    });
    expect(operations[0].asset.code).toBe('USDC');
    expect(operations[0].asset.issuer).toBe(DEFAULT_USDC_ISSUER);
    expect(operations[1]).toMatchObject({
      type: 'payment',
      destination: merchant,
      amount: '416.6666667',
    });
    expect(operations[1].asset.isNative()).toBe(true);
  });

  it('builds a single USDC payment operation for a 100% USDC split', () => {
    const split = calc({ usdcPercentage: 100 });
    const operations = paymentOperations(buildTransaction(split, { merchantAccount: merchant }));

    expect(operations).toHaveLength(1);
    expect(operations[0].asset.code).toBe('USDC');
    expect(operations[0].amount).toBe('100.0000000');
  });

  it('builds a single native payment operation for a 100% XLM split', () => {
    const split = calc({ usdcPercentage: 0 });
    const operations = paymentOperations(buildTransaction(split, { merchantAccount: merchant }));

    expect(operations).toHaveLength(1);
    expect(operations[0].asset.isNative()).toBe(true);
    expect(operations[0].amount).toBe('833.3333333');
  });

  it('uses the custom USDC issuer when provided', () => {
    const issuer = Keypair.random().publicKey();
    const split = calc({ usdcIssuer: issuer });
    const operations = paymentOperations(
      buildTransaction(split, { merchantAccount: merchant, usdcIssuer: issuer }),
    );

    expect(operations[0].asset.issuer).toBe(issuer);
  });

  it('produces a serializable transaction tied to the requested network and timeout', () => {
    const split = calc();
    const before = Math.floor(Date.now() / 1000);
    const tx = buildTransaction(split, { merchantAccount: merchant, timeout: 60 });

    expect(() => tx.toXDR()).not.toThrow();
    expect(tx.networkPassphrase).toBe(Networks.TESTNET);
    expect(Number(tx.timeBounds?.maxTime)).toBeGreaterThanOrEqual(before + 60);
  });
});

describe('buildSplitAuthEntries', () => {
  const source = Keypair.random().publicKey();
  const merchant = Keypair.random().publicKey();

  it('creates one auth entry per active token in the split', () => {
    const split = calc();
    const entries = buildSplitAuthEntries(source, merchant, split);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      token: split.usdcAllocation.asset,
      symbol: 'USDC',
      from: source,
      to: merchant,
      amountStroops: 500_000_000n,
      amountDecimal: '50.0000000',
    });
    expect(entries[0].maxAmountWithSlippage).toBeUndefined();
    expect(entries[1]).toMatchObject({
      token: 'native',
      symbol: 'XLM',
      from: source,
      to: merchant,
      amountStroops: 4_166_666_667n,
      amountDecimal: '416.6666667',
    });
    expect(entries[1].maxAmountWithSlippage).toBe('420.8333333');
  });

  it('omits the XLM entry for a 100% USDC split', () => {
    const entries = buildSplitAuthEntries(source, merchant, calc({ usdcPercentage: 100 }));

    expect(entries).toHaveLength(1);
    expect(entries[0].symbol).toBe('USDC');
  });

  it('omits the USDC entry for a 0% USDC split', () => {
    const entries = buildSplitAuthEntries(source, merchant, calc({ usdcPercentage: 0 }));

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      token: 'native',
      symbol: 'XLM',
      maxAmountWithSlippage: '841.6666667',
    });
  });

  it('uses the supplied USDC contract id as the USDC token', () => {
    const contractId = `C${Keypair.random().publicKey().slice(1)}`;
    const entries = buildSplitAuthEntries(source, merchant, calc(), contractId);

    expect(entries[0].token).toBe(contractId);
  });

  it('returns no entries for a zero-total split', () => {
    const entries = buildSplitAuthEntries(source, merchant, calc({ totalCheckoutUsd: 0 }));

    expect(entries).toEqual([]);
  });
});
