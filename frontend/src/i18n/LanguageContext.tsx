import { createContext, useContext, useMemo, useState, ReactNode } from 'react';
import { Locale, Messages } from './types';
import { detectLocale, persistLocale } from './locale';
import { en } from './en';
import { pt } from './pt';
import { es } from './es';

const MESSAGES_BY_LOCALE: Record<Locale, Messages> = { en, pt, es };

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  messages: Messages;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectLocale());

  const value = useMemo<LanguageContextValue>(
    () => ({
      locale,
      setLocale: (next: Locale) => {
        persistLocale(next);
        setLocaleState(next);
      },
      messages: MESSAGES_BY_LOCALE[locale],
    }),
    [locale]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}
