import { Locale } from '../i18n/types';

const INTL_LOCALE: Record<Locale, string> = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };

/** Locale-aware date formatting (unlike the Fluxo de Projetos pages' fixed dd/mm/yyyy helper) — used where pt/en/es correctness matters, like the Help page. */
export function formatLocaleDate(dateISO: string, locale: Locale): string {
  const date = dateISO.length <= 10 ? new Date(`${dateISO}T00:00:00`) : new Date(dateISO);
  return date.toLocaleDateString(INTL_LOCALE[locale], { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Date + time for history cards (e.g. "19/09/2026, 14:32"). */
export function formatLocaleDateTime(dateISO: string, locale: Locale): string {
  const date = new Date(dateISO);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(INTL_LOCALE[locale], { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
