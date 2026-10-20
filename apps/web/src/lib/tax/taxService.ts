import { useMemo } from 'react';

export type ProductTaxClassification = 'standard' | 'digital_service' | 'physical_goods' | 'exempt';

export type TaxRuleType = 'EU_VAT' | 'US_STATE' | 'STANDARD_GLOBAL';

export interface MerchantTaxRule {
  type: TaxRuleType;
  standardRate?: number; // e.g. 0.10 for 10%
  customRates?: Record<string, number>;
  exemptClassifications?: ProductTaxClassification[];
}

export interface TaxCalculationInput {
  subtotal: number;
  country?: string;
  postalCode?: string;
  classification?: ProductTaxClassification;
  rule?: MerchantTaxRule;
}

export interface TaxBreakdown {
  jurisdiction: string;
  type: TaxRuleType;
  rate: number;
  percentage: number;
  amount: number;
  subtotal: number;
  totalWithTax: number;
  receiptMetadata: {
    tax_type: string;
    tax_jurisdiction: string;
    tax_rate_bps: number;
    tax_amount: string;
  };
  accountingExport: {
    jurisdiction: string;
    rule: TaxRuleType;
    rate_formatted: string;
    taxable_subtotal: number;
    tax_collected: number;
    currency: string;
  };
}

export const EU_VAT_RATES: Record<string, number> = {
  AT: 0.2,
  BE: 0.21,
  BG: 0.2,
  CY: 0.19,
  CZ: 0.21,
  DE: 0.19,
  DK: 0.25,
  EE: 0.22,
  ES: 0.21,
  FI: 0.255,
  FR: 0.2,
  GR: 0.24,
  HR: 0.25,
  HU: 0.27,
  IE: 0.23,
  IT: 0.22,
  LT: 0.21,
  LU: 0.17,
  LV: 0.21,
  MT: 0.18,
  NL: 0.21,
  PL: 0.23,
  PT: 0.23,
  RO: 0.19,
  SE: 0.25,
  SI: 0.22,
  SK: 0.2,
};

export const US_STATE_RATES: Record<string, number> = {
  CA: 0.0725,
  NY: 0.04,
  TX: 0.0625,
  FL: 0.06,
  WA: 0.065,
  IL: 0.0625,
  PA: 0.06,
  OR: 0.0,
  DE: 0.0,
  MT: 0.0,
  NH: 0.0,
  AK: 0.0,
};

export function lookupUSStateByPostalCode(postalCode: string): string | null {
  const clean = postalCode.trim().slice(0, 5);
  const zip = parseInt(clean, 10);
  if (Number.isNaN(zip)) return null;

  if (zip >= 90000 && zip <= 96199) return 'CA';
  if (zip >= 10000 && zip <= 14999) return 'NY';
  if (zip >= 75000 && zip <= 79999) return 'TX';
  if (zip >= 32000 && zip <= 34999) return 'FL';
  if (zip >= 98000 && zip <= 99499) return 'WA';
  if (zip >= 60000 && zip <= 62999) return 'IL';
  if (zip >= 19000 && zip <= 19699) return 'PA';
  if (zip >= 97000 && zip <= 97999) return 'OR';
  if (zip >= 19700 && zip <= 19999) return 'DE';
  if (zip >= 59000 && zip <= 59999) return 'MT';
  if (zip >= 3000 && zip <= 3899) return 'NH';
  if (zip >= 99500 && zip <= 99999) return 'AK';

  return null;
}

export function calculateTax({
  subtotal,
  country = 'US',
  postalCode = '',
  classification = 'standard',
  rule,
}: TaxCalculationInput): TaxBreakdown {
  const normCountry = country.trim().toUpperCase();
  const ruleType =
    rule?.type ??
    (normCountry === 'US'
      ? 'US_STATE'
      : EU_VAT_RATES[normCountry] !== undefined
        ? 'EU_VAT'
        : 'STANDARD_GLOBAL');

  const isExempt =
    classification === 'exempt' ||
    (rule?.exemptClassifications && rule.exemptClassifications.includes(classification));

  let rate = 0;
  let jurisdiction = normCountry;

  if (!isExempt && subtotal > 0) {
    if (rule?.customRates && rule.customRates[normCountry] !== undefined) {
      rate = rule.customRates[normCountry];
    } else if (ruleType === 'EU_VAT') {
      if (EU_VAT_RATES[normCountry] !== undefined) {
        rate = EU_VAT_RATES[normCountry];
        jurisdiction = `EU-${normCountry}`;
      } else {
        rate = rule?.standardRate ?? 0.2;
        jurisdiction = 'EU-VAT';
      }
    } else if (ruleType === 'US_STATE' && normCountry === 'US') {
      const state = postalCode ? lookupUSStateByPostalCode(postalCode) : null;
      if (state && US_STATE_RATES[state] !== undefined) {
        rate = US_STATE_RATES[state];
        jurisdiction = `US-${state}`;
      } else {
        rate = rule?.standardRate ?? 0.05;
        jurisdiction = state ? `US-${state}` : 'US-STANDARD';
      }
    } else if (ruleType === 'STANDARD_GLOBAL') {
      rate = rule?.standardRate ?? 0.08;
      jurisdiction = `${normCountry}-GLOBAL`;
    } else {
      rate = rule?.standardRate ?? 0;
      jurisdiction = normCountry;
    }
  }

  const percentage = Math.round(rate * 10000) / 100;
  const amount = Math.round(subtotal * rate * 100) / 100;
  const totalWithTax = Math.round((subtotal + amount) * 100) / 100;

  return {
    jurisdiction,
    type: ruleType,
    rate,
    percentage,
    amount,
    subtotal,
    totalWithTax,
    receiptMetadata: {
      tax_type: ruleType,
      tax_jurisdiction: jurisdiction,
      tax_rate_bps: Math.round(rate * 10000),
      tax_amount: amount.toFixed(2),
    },
    accountingExport: {
      jurisdiction,
      rule: ruleType,
      rate_formatted: `${percentage.toFixed(2)}%`,
      taxable_subtotal: subtotal,
      tax_collected: amount,
      currency: 'USDC',
    },
  };
}

export function useTaxCalculation(input: TaxCalculationInput): TaxBreakdown {
  const { subtotal, country, postalCode, classification, rule } = input;
  return useMemo(
    () => calculateTax({ subtotal, country, postalCode, classification, rule }),
    [subtotal, country, postalCode, classification, rule],
  );
}
