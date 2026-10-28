// @vitest-environment jsdom
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, useLocale, useTranslation } from './I18nProvider';

function setCookie(value: string | null) {
  document.cookie = value ? `accensa_locale=${value}; Path=/` : '';
}

function clearCookies() {
  document.cookie.split('; ').forEach((entry) => {
    const name = entry.split('=')[0];
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
  });
}

function setBrowserLanguage(language: string) {
  Object.defineProperty(window.navigator, 'language', { value: language, configurable: true });
}

function Probe() {
  const { locale, setLocale } = useLocale();
  const { t } = useTranslation('common');
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="text">{t('language')}</span>
      <button onClick={() => setLocale('es')}>to-es</button>
      <button onClick={() => setLocale(locale)}>to-same</button>
    </div>
  );
}

describe('I18nProvider', () => {
  beforeEach(() => {
    clearCookies();
    setBrowserLanguage('en-US');
  });

  afterEach(() => {
    clearCookies();
    vi.restoreAllMocks();
  });

  it('honors a valid, supported locale cookie', () => {
    setCookie('fr');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByTestId('locale').textContent).toBe('fr');
  });

  it('ignores an unsupported cookie and falls back to navigator.language', () => {
    setCookie('xx');
    setBrowserLanguage('es-ES');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByTestId('locale').textContent).toBe('es');
  });

  it('falls back to the default locale when neither cookie nor navigator match', () => {
    setCookie(null);
    setBrowserLanguage('de-DE');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByTestId('locale').textContent).toBe('en');
  });

  it('setLocale persists a cookie, updates documentElement.lang, and switches translation output', async () => {
    setCookie(null);
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByTestId('text').textContent).toBe('Language');

    await act(async () => {
      screen.getByText('to-es').click();
    });

    expect(screen.getByTestId('locale').textContent).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    expect(document.cookie).toContain('accensa_locale=es');
    expect(screen.getByTestId('text').textContent).toBe('Idioma');
  });

  it('setLocale with the current locale is a no-op (cookie is not rewritten)', async () => {
    setCookie('fr');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(document.cookie).toContain('accensa_locale=fr');
    clearCookies();

    await act(async () => {
      screen.getByText('to-same').click();
    });

    expect(document.cookie).not.toContain('accensa_locale=');
  });

  it('useLocale throws outside the provider', () => {
    const Bare = () => {
      useLocale();
      return null;
    };

    expect(() => render(<Bare />)).toThrow('useLocale must be used within I18nProvider');
  });
});
