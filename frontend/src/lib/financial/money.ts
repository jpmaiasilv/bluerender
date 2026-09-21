import { Locale } from '../../i18n/types';

const LOCALE_TAG: Record<Locale, string> = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };

/** Money is stored as integer cents everywhere in this module — this is the
 * only place it becomes a display string. BRL is the only currency this
 * build supports (see spec: no multi-currency yet); `locale` only changes
 * digit-grouping/decimal conventions, not the currency itself. */
export function formatMoneyCents(cents: number, locale: Locale): string {
  return new Intl.NumberFormat(LOCALE_TAG[locale], {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Parses a user-typed amount (accepts "1250,50", "1250.50", "1.250,50") into cents. */
export function parseAmountToCents(input: string): number {
  const normalized = input.trim().replace(/\s/g, '');
  if (!normalized) return 0;
  // If both separators are present, the last one is the decimal separator.
  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  let cleaned: string;
  if (lastComma > lastDot) {
    cleaned = normalized.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    cleaned = normalized.replace(/,/g, '');
  } else {
    cleaned = normalized.replace(',', '.');
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function centsToAmountString(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}
