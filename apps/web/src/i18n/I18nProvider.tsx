'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import i18n from 'i18next';
import { initReactI18next, I18nextProvider, useTranslation } from 'react-i18next';
import { defaultLocale, isLocale, type Locale } from './locales';
import { resources } from './messages';

const localeCookie = 'accensa_locale';

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: defaultLocale,
    fallbackLng: defaultLocale,
    ns: ['common', 'checkout', 'merchant'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
  });
}

const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void } | null>(
  null,
);

function readLocale(): Locale {
  if (typeof document === 'undefined') return defaultLocale;
  const stored = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${localeCookie}=`))
    ?.split('=')[1];
  if (isLocale(stored)) return stored;
  const browserLocale = navigator.language.split('-')[0];
  return isLocale(browserLocale) ? browserLocale : defaultLocale;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readLocale);

  useEffect(() => {
    void i18n.changeLanguage(locale);
    document.cookie = `${localeCookie}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = (nextLocale: Locale) => {
    if (nextLocale !== locale) setLocaleState(nextLocale);
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('useLocale must be used within I18nProvider');
  return context;
}

export { useTranslation };
