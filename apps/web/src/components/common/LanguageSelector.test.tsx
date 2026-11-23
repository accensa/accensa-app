// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageSelector } from './LanguageSelector';
import { useLocale } from '@/i18n/I18nProvider';
import { useTranslation } from 'react-i18next';

vi.mock('@/i18n/I18nProvider', () => ({
  useLocale: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(),
}));

describe('LanguageSelector', () => {
  const setLocaleMock = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(useTranslation).mockReturnValue({
      t: ((key: string) => key) as unknown,
    } as ReturnType<typeof useTranslation>);
    vi.mocked(useLocale).mockReturnValue({
      locale: 'en',
      setLocale: setLocaleMock,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders exactly four options matching locales in order', () => {
    render(<LanguageSelector />);
    const select = screen.getByRole('combobox', { name: 'language' }) as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll('option'));

    expect(options).toHaveLength(4);
    expect(options.map((opt) => opt.value)).toEqual(['en', 'es', 'fr', 'pt']);
  });

  it('shows the selected locale flag and label when rendered with fr', () => {
    vi.mocked(useLocale).mockReturnValue({
      locale: 'fr',
      setLocale: setLocaleMock,
    });

    render(<LanguageSelector />);
    const select = screen.getByRole('combobox', { name: 'language' }) as HTMLSelectElement;

    expect(select.value).toBe('fr');
    expect(screen.getByText('🇫🇷')).toBeInTheDocument();
    expect(screen.getByText('🇫🇷 languages.fr')).toBeInTheDocument();
  });

  it('calls setLocale with the chosen value on change', () => {
    render(<LanguageSelector />);
    const select = screen.getByRole('combobox', { name: 'language' });

    fireEvent.change(select, { target: { value: 'es' } });

    expect(setLocaleMock).toHaveBeenCalledTimes(1);
    expect(setLocaleMock).toHaveBeenCalledWith('es');
  });

  it('renders each option with its corresponding flag and label', () => {
    render(<LanguageSelector />);
    const select = screen.getByRole('combobox', { name: 'language' }) as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll('option'));

    expect(options[0].textContent).toBe('🇬🇧 languages.en');
    expect(options[1].textContent).toBe('🇪🇸 languages.es');
    expect(options[2].textContent).toBe('🇫🇷 languages.fr');
    expect(options[3].textContent).toBe('🇵🇹 languages.pt');
  });
});
