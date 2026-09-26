import { describe, expect, it } from 'vitest';
import { resources } from './messages';
import { locales } from './locales';

function keys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('translation catalogs', () => {
  it('contain the same keys for every supported locale and domain', () => {
    for (const domain of Object.keys(resources.en) as Array<keyof (typeof resources)['en']>) {
      const expected = keys(resources.en[domain]).sort();
      for (const locale of locales) {
        expect(keys(resources[locale][domain]).sort(), `${locale}/${domain}`).toEqual(expected);
      }
    }
  });
});
