import { Locale } from './types';

const STORAGE_KEY = 'render-lab:locale';

function isLocale(value: string | null): value is Locale {
  return value === 'en' || value === 'pt' || value === 'es';
}

/** navigator.language -> Locale, e.g. pt-BR/pt-PT -> pt, es-* -> es, else -> en. */
function fromNavigatorLanguage(): Locale {
  const lang = navigator.language?.toLowerCase() ?? '';
  if (lang.startsWith('pt')) return 'pt';
  if (lang.startsWith('es')) return 'es';
  return 'en';
}

export function detectLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (isLocale(stored)) return stored;
  return fromNavigatorLanguage();
}

export function persistLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
}
