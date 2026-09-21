import { Locale } from '../i18n/types';

const INTL_LOCALE: Record<Locale, string> = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };

/** "há 2 horas" / "2 hours ago" / "hace 2 horas" — Intl.RelativeTimeFormat, never a hand-rolled string. */
export function formatRelativeTime(timestampMs: number, locale: Locale, nowMs = Date.now()): string {
  const diffSeconds = Math.round((timestampMs - nowMs) / 1000);
  const rtf = new Intl.RelativeTimeFormat(INTL_LOCALE[locale], { numeric: 'auto' });

  const absSeconds = Math.abs(diffSeconds);
  if (absSeconds < 60) return rtf.format(diffSeconds, 'second');
  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) return rtf.format(diffDays, 'day');
  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) return rtf.format(diffMonths, 'month');
  const diffYears = Math.round(diffMonths / 12);
  return rtf.format(diffYears, 'year');
}
