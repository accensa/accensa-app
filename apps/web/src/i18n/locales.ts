export const locales = ['en', 'es', 'fr', 'pt'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

export function isLocale(value: string | null | undefined): value is Locale {
  return value !== undefined && value !== null && locales.includes(value as Locale);
}
