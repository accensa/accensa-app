import { describe, it, expect } from 'vitest';
import { price, type PricingRule } from './engine';

const simpleMarkup: PricingRule[] = [
  {
    name: 'flat_5pct',
    priority: 1,
    effect: { kind: 'markup_pct', percent: '5' },
  },
];

describe('price() engine (#168)', () => {
  it('applies a flat percentage markup exactly', () => {
    const out = price(simpleMarkup, { merchant: 'GAAA' }, '100');
    expect(out).toEqual({
      base: '100',
      markup: '5',
      surcharge: '0',
      total: '105',
      applied: [{ rule: 'flat_5pct', effect: 'markup_pct:{"kind":"markup_pct","percent":"5"}' }],
    });
  });

  it('keeps decimal math exact (0.1 + 0.2 style)', () => {
    const out = price(
      [{ name: 'm', priority: 0, effect: { kind: 'markup_pct', percent: '10.5' } }],
      { merchant: 'GAAA' },
      '0.10',
    );
    expect(out.total).toBe('0.1105');
  });

  it('scales markup with quantity', () => {
    const out = price(
      [{ name: 'fixed', priority: 0, effect: { kind: 'markup_fixed', amount: '1' } }],
      { merchant: 'GAAA', quantity: 3 },
      '10',
    );
    expect(out.total).toBe('33');
  });

  it('applies only the first matching rule of each kind', () => {
    const rules: PricingRule[] = [
      { name: 'first', priority: 2, effect: { kind: 'markup_pct', percent: '10' } },
      { name: 'second', priority: 5, effect: { kind: 'markup_pct', percent: '99' } },
    ];
    const out = price(rules, { merchant: 'GAAA' }, '100');
    expect(out.markup).toBe('10');
    expect(out.applied).toHaveLength(1);
  });

  it('geo-tier rules match only their region', () => {
    const rules: PricingRule[] = [
      { name: 'eu_pct', priority: 0, match: { geo: 'eu' }, effect: { kind: 'markup_pct', percent: '20' } },
      { name: 'na_pct', priority: 0, match: { geo: 'na' }, effect: { kind: 'markup_pct', percent: '5' } },
    ];
    expect(price(rules, { merchant: 'GAAA', geo: 'eu' }, '100').total).toBe('120');
    expect(price(rules, { merchant: 'GAAA', geo: 'na' }, '100').total).toBe('105');
    expect(price(rules, { merchant: 'GAAA', geo: 'apac' }, '100').total).toBe('100');
  });

  it('volume tiers apply only in their range', () => {
    const rules: PricingRule[] = [
      {
        name: 'tier_under_10',
        priority: 0,
        match: { minQuantity: 1, maxQuantity: 10 },
        effect: { kind: 'markup_pct', percent: '10' },
      },
      {
        name: 'tier_10_plus',
        priority: 0,
        match: { minQuantity: 10 },
        effect: { kind: 'markup_pct', percent: '2' },
      },
    ];
    expect(price(rules, { merchant: 'GAAA', quantity: 5 }, '100').total).toBe('550');
    expect(price(rules, { merchant: 'GAAA', quantity: 20 }, '100').total).toBe('2040');
  });

  it('enforces a floor', () => {
    const rules: PricingRule[] = [
      { name: 'floor', priority: 0, effect: { kind: 'floor', amount: '150' } },
    ];
    const out = price(rules, { merchant: 'GAAA' }, '10');
    expect(out.total).toBe('150');
  });

  it('never negatives a total with a >100% surcharge', () => {
    const rules: PricingRule[] = [
      { name: 'surcharge', priority: 0, effect: { kind: 'surcharge_fixed', amount: '5' } },
    ];
    const out = price(rules, { merchant: 'GAAA' }, '1');
    expect(out.total).toBe('6');
  });

  it('rejects malformed decimals', () => {
    expect(() => price(simpleMarkup, { merchant: 'GAAA' }, 'abc')).toThrow(/invalid decimal/);
    expect(() => price(simpleMarkup, { merchant: 'GAAA' }, '')).toThrow(/invalid decimal/);
  });

  it('rejects a non-positive integer quantity', () => {
    expect(() => price(simpleMarkup, { merchant: 'GAAA', quantity: 0 }, '10')).toThrow(
      /positive integer/,
    );
  });
});