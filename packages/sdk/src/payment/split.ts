/**
 * Split Tender Payments (Multi-Token USDC + XLM)
 *
 * Implements multi-token allocation calculation, exchange rate conversion,
 * slippage protection, and atomic transaction batch building for split checkout.
 *
 * @module
 */

import {
  Account,
  Asset,
  Operation,
  TransactionBuilder,
  type Transaction,
} from '@stellar/stellar-sdk';
import { toStroops, fromStroops } from '../price-formatter';

/** Standard Stellar testnet/mainnet USDC asset issuer */
export const DEFAULT_USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
export const DEFAULT_USDC_ASSET = `USDC:${DEFAULT_USDC_ISSUER}`;

export interface TokenAllocation {
  /** Asset identifier ('native' or 'CODE:ISSUER') */
  asset: string;
  /** Human-readable asset code ('USDC' or 'XLM') */
  symbol: string;
  /** Formatted decimal payment amount with 7 decimal places */
  amount: string;
  /** Equivalent amount in integer stroops (1 unit = 10,000,000 stroops) */
  amountStroops: bigint;
  /** Fiat USD value covered by this token */
  fiatValueUsd: number;
  /** Allocation percentage (0 to 100) */
  percentage: number;
  /** Customer balance formatted string, if provided */
  balance?: string;
  /** Customer balance in stroops, if provided */
  balanceStroops?: bigint;
}

export interface SplitRates {
  /** XLM exchange rate in USD (e.g. 0.12 means 1 XLM = $0.12) */
  xlmUsdRate: number;
  /** USDC exchange rate in USD (defaults to 1.0) */
  usdcUsdRate?: number;
}

export interface SplitCustomerBalances {
  /** Available customer USDC balance (decimal string or number) */
  usdc?: string | number;
  /** Available customer XLM balance (decimal string or number) */
  xlm?: string | number;
}

export interface SplitCalculationParams {
  /** Required checkout total in USD */
  totalCheckoutUsd: number;
  /** Percentage of the total to be paid in USDC (0 to 100) */
  usdcPercentage: number;
  /** Real-time market exchange rates */
  rates: SplitRates;
  /** Optional customer wallet balances for affordability checks */
  customerBalances?: SplitCustomerBalances;
  /** Slippage tolerance percentage (e.g. 1.0 for 1% max price movement). Default: 1.0 */
  slippageTolerancePercent?: number;
  /** Custom USDC issuer address */
  usdcIssuer?: string;
}

export interface SplitCalculationResult {
  /** Total required checkout amount in USD */
  totalCheckoutUsd: number;
  /** USDC payment allocation */
  usdcAllocation: TokenAllocation;
  /** XLM payment allocation */
  xlmAllocation: TokenAllocation;
  /** List of all token allocations in this split */
  allocations: TokenAllocation[];
  /** Total USD amount covered by the allocations */
  coveredUsd: number;
  /** Whether the combined allocations fully cover the checkout amount */
  isFullyCovered: boolean;
  /** Effective XLM/USD rate used */
  effectiveRate: number;
  /** Slippage tolerance percentage applied */
  slippageTolerancePercent: number;
  /** Maximum XLM deduction allowed under the slippage tolerance */
  maxXlmDeductionWithSlippage: string;
  /** Maximum XLM deduction in stroops under the slippage tolerance */
  maxXlmStroopsWithSlippage: bigint;
  /** Whether the customer's wallet balance satisfies the payment */
  canAfford: boolean;
  /** List of tokens where customer balance is insufficient */
  insufficientTokens: string[];
}

export interface SplitPaymentTransactionParams {
  /** Customer wallet public key initiating the payment */
  sourceAccount: string;
  /** Merchant destination public key receiving the payment */
  merchantAccount: string;
  /** Current sequence number of the customer account */
  sequence: string | number;
  /** Computed split calculation result */
  splitResult: SplitCalculationResult;
  /** Stellar network passphrase */
  networkPassphrase: string;
  /** USDC issuer address */
  usdcIssuer?: string;
  /** Base fee in stroops (default: '100') */
  baseFee?: string;
  /** Transaction timeout in seconds (default: 30) */
  timeout?: number;
}

export interface SorobanSplitAuthEntry {
  token: string;
  symbol: string;
  from: string;
  to: string;
  amountStroops: bigint;
  amountDecimal: string;
  maxAmountWithSlippage?: string;
}

/**
 * Formats a number to 7 decimal places as a string without scientific notation.
 */
function toFixed7(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0.0000000';
  return value.toFixed(7);
}

/**
 * Calculates token allocations, exchange rate conversions, and slippage bounds
 * for a split USDC + XLM checkout payment.
 */
export function calculateSplitPayment(params: SplitCalculationParams): SplitCalculationResult {
  const total = Math.max(0, params.totalCheckoutUsd);
  const usdcPct = Math.min(100, Math.max(0, params.usdcPercentage));
  const xlmPct = Number((100 - usdcPct).toFixed(4));

  const usdcRate =
    params.rates.usdcUsdRate && params.rates.usdcUsdRate > 0 ? params.rates.usdcUsdRate : 1.0;
  const xlmRate = params.rates.xlmUsdRate > 0 ? params.rates.xlmUsdRate : 0.1;
  const slippage = params.slippageTolerancePercent ?? 1.0;

  // Split the USD total
  const usdcUsd = Number(((total * usdcPct) / 100).toFixed(7));
  const xlmUsd = Number((total - usdcUsd).toFixed(7));

  // Convert to token amounts
  const usdcUnits = usdcUsd / usdcRate;
  const xlmUnits = xlmRate > 0 ? xlmUsd / xlmRate : 0;

  const usdcAmountStr = toFixed7(usdcUnits);
  const xlmAmountStr = toFixed7(xlmUnits);

  const usdcStroops = toStroops(usdcAmountStr) ?? 0n;
  const xlmStroops = toStroops(xlmAmountStr) ?? 0n;

  // Slippage calculations: If XLM price drops by slippage%, maximum XLM required rises
  const slippageMultiplier = 1 + slippage / 100;
  const maxXlmUnits = xlmUnits * slippageMultiplier;
  const maxXlmAmountStr = toFixed7(maxXlmUnits);
  const maxXlmStroops = toStroops(maxXlmAmountStr) ?? 0n;

  const usdcIssuer = params.usdcIssuer ?? DEFAULT_USDC_ISSUER;
  const usdcAssetId = `USDC:${usdcIssuer}`;

  // Process customer balances if provided
  let usdcBalanceStr: string | undefined;
  let usdcBalanceStroops: bigint | undefined;
  let xlmBalanceStr: string | undefined;
  let xlmBalanceStroops: bigint | undefined;

  const insufficientTokens: string[] = [];

  if (params.customerBalances) {
    if (params.customerBalances.usdc !== undefined) {
      usdcBalanceStr = toFixed7(Number(params.customerBalances.usdc));
      usdcBalanceStroops = toStroops(usdcBalanceStr) ?? 0n;
      if (usdcStroops > usdcBalanceStroops) {
        insufficientTokens.push('USDC');
      }
    }
    if (params.customerBalances.xlm !== undefined) {
      xlmBalanceStr = toFixed7(Number(params.customerBalances.xlm));
      xlmBalanceStroops = toStroops(xlmBalanceStr) ?? 0n;
      // Compare against max XLM with slippage to ensure safe execution
      if (maxXlmStroops > xlmBalanceStroops) {
        insufficientTokens.push('XLM');
      }
    }
  }

  const usdcAllocation: TokenAllocation = {
    asset: usdcAssetId,
    symbol: 'USDC',
    amount: usdcAmountStr,
    amountStroops: usdcStroops,
    fiatValueUsd: usdcUsd,
    percentage: usdcPct,
    balance: usdcBalanceStr,
    balanceStroops: usdcBalanceStroops,
  };

  const xlmAllocation: TokenAllocation = {
    asset: 'native',
    symbol: 'XLM',
    amount: xlmAmountStr,
    amountStroops: xlmStroops,
    fiatValueUsd: xlmUsd,
    percentage: xlmPct,
    balance: xlmBalanceStr,
    balanceStroops: xlmBalanceStroops,
  };

  const coveredUsd = Number((usdcUsd + xlmUsd).toFixed(7));
  const isFullyCovered = Math.abs(coveredUsd - total) <= 0.0001;
  const canAfford = insufficientTokens.length === 0;

  return {
    totalCheckoutUsd: total,
    usdcAllocation,
    xlmAllocation,
    allocations: [usdcAllocation, xlmAllocation],
    coveredUsd,
    isFullyCovered,
    effectiveRate: xlmRate,
    slippageTolerancePercent: slippage,
    maxXlmDeductionWithSlippage: maxXlmAmountStr,
    maxXlmStroopsWithSlippage: maxXlmStroops,
    canAfford,
    insufficientTokens,
  };
}

/**
 * Validates that the sum of token allocation USD values matches the required checkout total.
 */
export function validateSplitTotals(
  allocations: TokenAllocation[],
  requiredTotalUsd: number,
  tolerance: number = 0.0001,
): boolean {
  const sumUsd = allocations.reduce((acc, a) => acc + a.fiatValueUsd, 0);
  return Math.abs(sumUsd - requiredTotalUsd) <= tolerance;
}

/**
 * Suggests an optimal split percentage that uses maximum customer USDC balance first,
 * with the remaining balance covered by XLM, minimizing market slippage risk.
 */
export function suggestOptimalSplit(totalCheckoutUsd: number, customerUsdcBalance: number): number {
  if (totalCheckoutUsd <= 0) return 100;
  if (customerUsdcBalance >= totalCheckoutUsd) {
    return 100;
  }
  const affordablePct = (customerUsdcBalance / totalCheckoutUsd) * 100;
  return Math.min(100, Math.max(0, Number(affordablePct.toFixed(2))));
}

/**
 * Builds a single atomic Stellar Transaction containing paired payment operations
 * for both USDC and XLM allocations.
 *
 * In Stellar, multiple operations within a single transaction are strictly atomic:
 * either all operations execute and settle successfully, or the entire transaction fails.
 */
export function buildSplitPaymentTransaction(params: SplitPaymentTransactionParams): Transaction {
  const {
    sourceAccount,
    merchantAccount,
    sequence,
    splitResult,
    networkPassphrase,
    usdcIssuer = DEFAULT_USDC_ISSUER,
    baseFee = '100',
    timeout = 30,
  } = params;

  const account = new Account(sourceAccount, sequence.toString());
  const txBuilder = new TransactionBuilder(account, {
    fee: baseFee,
    networkPassphrase,
  });

  const { usdcAllocation, xlmAllocation } = splitResult;

  // Add USDC operation if non-zero
  if (usdcAllocation.amountStroops > 0n) {
    const usdcAsset = new Asset('USDC', usdcIssuer);
    txBuilder.addOperation(
      Operation.payment({
        destination: merchantAccount,
        asset: usdcAsset,
        amount: usdcAllocation.amount,
      }),
    );
  }

  // Add XLM operation if non-zero
  if (xlmAllocation.amountStroops > 0n) {
    txBuilder.addOperation(
      Operation.payment({
        destination: merchantAccount,
        asset: Asset.native(),
        amount: xlmAllocation.amount,
      }),
    );
  }

  return txBuilder.setTimeout(timeout).build();
}

/**
 * Generates structured Soroban authorization entries for each token in the split payment.
 */
export function buildSplitAuthEntries(
  sourceAccount: string,
  merchantAccount: string,
  splitResult: SplitCalculationResult,
  usdcContractId?: string,
): SorobanSplitAuthEntry[] {
  const entries: SorobanSplitAuthEntry[] = [];
  const { usdcAllocation, xlmAllocation } = splitResult;

  if (usdcAllocation.amountStroops > 0n) {
    entries.push({
      token: usdcContractId ?? usdcAllocation.asset,
      symbol: 'USDC',
      from: sourceAccount,
      to: merchantAccount,
      amountStroops: usdcAllocation.amountStroops,
      amountDecimal: usdcAllocation.amount,
    });
  }

  if (xlmAllocation.amountStroops > 0n) {
    entries.push({
      token: 'native',
      symbol: 'XLM',
      from: sourceAccount,
      to: merchantAccount,
      amountStroops: xlmAllocation.amountStroops,
      amountDecimal: xlmAllocation.amount,
      maxAmountWithSlippage: splitResult.maxXlmDeductionWithSlippage,
    });
  }

  return entries;
}

/**
 * Applies slippage tolerance bounds to a base rate or amount.
 */
export function applySlippageTolerance(
  amount: number | string,
  slippagePercent: number,
  mode: 'maximum_pay' | 'minimum_receive',
): string {
  const num = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(num) || num <= 0) return '0.0000000';

  const factor = slippagePercent / 100;
  const result = mode === 'maximum_pay' ? num * (1 + factor) : num * (1 - factor);
  return toFixed7(result);
}
