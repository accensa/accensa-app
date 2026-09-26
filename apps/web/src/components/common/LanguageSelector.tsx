'use client';

import { useTranslation } from 'react-i18next';
import { locales, type Locale } from '@/i18n/locales';
import { useLocale } from '@/i18n/I18nProvider';

const flags: Record<Locale, string> = { en: '🇬🇧', es: '🇪🇸', fr: '🇫🇷', pt: '🇵🇹' };

export function LanguageSelector() {
  const { t } = useTranslation('common');
  const { locale, setLocale } = useLocale();

  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span aria-hidden="true">{flags[locale]}</span>
      <span className="sr-only">{t('language')}</span>
      <select
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        aria-label={t('language')}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
      >
        {locales.map((option) => (
          <option key={option} value={option}>
            {flags[option]} {t(`languages.${option}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
