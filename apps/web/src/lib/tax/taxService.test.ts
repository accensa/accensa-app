import { describe, expect, it } from 'vitest';
import {
  calculateTax,
  lookupUSStateByPostalCode,
  EU_VAT_RATES,
  US_STATE_RATES,
} from './taxService';

describe('taxService', () => {
  describe('lookupUSStateByPostalCode', () => {
    it('identifies California postal codes', () => {
      expect(lookupUSStateByPostalCode('90210')).toBe('CA');
      expect(lookupUSStateByPostalCode('94105')).toBe('CA');
    });

    it('identifies New York postal codes', () => {
      expect(lookupUSStateByPostalCode('10001')).toBe('NY');
      expect(lookupUSStateByPostalCode('14201')).toBe('NY');
    });

    it('identifies Texas postal codes', () => {
      expect(lookupUSStateByPostalCode('75001')).toBe('TX');
    });

    it('identifies tax-exempt state postal codes (Oregon, Delaware, New Hampshire)', () => {
      expect(lookupUSStateByPostalCode('97201')).toBe('OR');
      expect(lookupUSStateByPostalCode('19801')).toBe('DE');
      expect(lookupUSStateByPostalCode('03101')).toBe('NH');
    });

    it('returns null for invalid or non-numeric postal codes', () => {
      expect(lookupUSStateByPostalCode('ABCDE')).toBeNull();
      expect(lookupUSStateByPostalCode('')).toBeNull();
    });
  });

  describe('calculateTax - EU VAT', () => {
    it('calculates 19% VAT for Germany', () => {
      const result = calculateTax({
        subtotal: 100,
        country: 'DE',
        rule: { type: 'EU_VAT' },
      });

      expect(result.type).toBe('EU_VAT');
      expect(result.rate).toBe(EU_VAT_RATES.DE);
      expect(result.percentage).toBe(19);
      expect(result.amount).toBe(19.0);
      expect(result.totalWithTax).toBe(119.0);
      expect(result.jurisdiction).toBe('EU-DE');
    });

    it('calculates 20% VAT for France', () => {
      const result = calculateTax({
        subtotal: 50,
        country: 'FR',
        rule: { type: 'EU_VAT' },
      });

      expect(result.amount).toBe(10.0);
      expect(result.totalWithTax).toBe(60.0);
    });

    it('falls back to standard rate for unspecified EU member', () => {
      const result = calculateTax({
        subtotal: 100,
        country: 'UNKNOWN',
        rule: { type: 'EU_VAT', standardRate: 0.18 },
      });

      expect(result.amount).toBe(18.0);
    });
  });

  describe('calculateTax - US State Sales Tax', () => {
    it('calculates 7.25% for California based on postal code', () => {
      const result = calculateTax({
        subtotal: 200,
        country: 'US',
        postalCode: '90210',
        rule: { type: 'US_STATE' },
      });

      expect(result.type).toBe('US_STATE');
      expect(result.rate).toBe(US_STATE_RATES.CA);
      expect(result.percentage).toBe(7.25);
      expect(result.amount).toBe(14.5);
      expect(result.totalWithTax).toBe(214.5);
      expect(result.jurisdiction).toBe('US-CA');
    });

    it('calculates 0% for tax-free Oregon', () => {
      const result = calculateTax({
        subtotal: 250,
        country: 'US',
        postalCode: '97201',
        rule: { type: 'US_STATE' },
      });

      expect(result.rate).toBe(0);
      expect(result.amount).toBe(0);
      expect(result.totalWithTax).toBe(250);
      expect(result.jurisdiction).toBe('US-OR');
    });

    it('does not charge US sales tax to non-US buyers when US_STATE rule is configured', () => {
      const result = calculateTax({
        subtotal: 100,
        country: 'DE',
        postalCode: '10115',
        rule: { type: 'US_STATE' },
      });

      expect(result.rate).toBe(0);
      expect(result.amount).toBe(0);
      expect(result.totalWithTax).toBe(100);
      expect(result.jurisdiction).toBe('DE');
    });

    it('infers EU VAT when rule is omitted for an EU country', () => {
      const result = calculateTax({
        subtotal: 100,
        country: 'DE',
      });

      expect(result.type).toBe('EU_VAT');
      expect(result.rate).toBe(0.19);
      expect(result.amount).toBe(19.0);
      expect(result.jurisdiction).toBe('EU-DE');
    });
  });

  describe('calculateTax - Exemptions and Custom Rules', () => {
    it('applies 0% tax for exempt product classification', () => {
      const result = calculateTax({
        subtotal: 100,
        country: 'DE',
        classification: 'exempt',
        rule: { type: 'EU_VAT' },
      });

      expect(result.rate).toBe(0);
      expect(result.amount).toBe(0);
      expect(result.totalWithTax).toBe(100);
    });

    it('applies merchant custom rate overrides', () => {
      const result = calculateTax({
        subtotal: 100,
        country: 'JP',
        rule: {
          type: 'STANDARD_GLOBAL',
          customRates: { JP: 0.1 },
        },
      });

      expect(result.rate).toBe(0.1);
      expect(result.amount).toBe(10.0);
      expect(result.totalWithTax).toBe(110.0);
    });
  });

  describe('Receipt Metadata & Accounting Export', () => {
    it('generates compliant on-chain receipt metadata and accounting export fields', () => {
      const result = calculateTax({
        subtotal: 100,
        country: 'DE',
        rule: { type: 'EU_VAT' },
      });

      expect(result.receiptMetadata).toEqual({
        tax_type: 'EU_VAT',
        tax_jurisdiction: 'EU-DE',
        tax_rate_bps: 1900,
        tax_amount: '19.00',
      });

      expect(result.accountingExport).toEqual({
        jurisdiction: 'EU-DE',
        rule: 'EU_VAT',
        rate_formatted: '19.00%',
        taxable_subtotal: 100,
        tax_collected: 19,
        currency: 'USDC',
      });
    });
  });
});
