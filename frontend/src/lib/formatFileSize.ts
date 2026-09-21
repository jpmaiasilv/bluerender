import { Locale } from '../i18n/types';

const LOCALE_TAG: Record<Locale, string> = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };

/** Mirrors lib/financial/money.ts's formatMoneyCents — locale only changes the decimal separator. */
export function formatFileSize(bytes: number, locale: Locale): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = new Intl.NumberFormat(LOCALE_TAG[locale], { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
  return `${formatted} ${units[unitIndex]}`;
}
