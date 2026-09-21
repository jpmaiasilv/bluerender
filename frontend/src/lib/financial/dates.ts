// Date-only ("YYYY-MM-DD") helpers used throughout the financial module.
// Deliberately never routes through Date.toISOString() for these — that
// serializes in UTC, which can silently shift a local calendar day (e.g. a
// transaction logged late at night in a UTC-3 timezone reading back as
// "tomorrow" in UTC). Every function here reads/writes local calendar
// fields (getFullYear/getMonth/getDate), never the UTC variants.

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local calendar date -> "YYYY-MM-DD", ignoring time-of-day and timezone offset. */
export function toDateOnly(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Today's local calendar date as "YYYY-MM-DD". */
export function todayISO(): string {
  return toDateOnly(new Date());
}

/** Parses a "YYYY-MM-DD" string into a local-midnight Date — never via
 * `new Date(str)` (which parses date-only strings as UTC midnight per the
 * ES spec, then prints as the previous day in negative-UTC timezones). */
export function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(value: string, days: number): string {
  const d = parseDateOnly(value);
  d.setDate(d.getDate() + days);
  return toDateOnly(d);
}

export function addMonths(value: string, months: number): string {
  const d = parseDateOnly(value);
  const day = d.getDate();
  d.setDate(1); // avoid month-rollover surprises (e.g. Jan 31 + 1 month)
  d.setMonth(d.getMonth() + months);
  const daysInTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, daysInTargetMonth));
  return toDateOnly(d);
}

export function daysBetween(fromISO: string, toISODate: string): number {
  const a = parseDateOnly(fromISO);
  const b = parseDateOnly(toISODate);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export type PeriodPreset = 'today' | 'yesterday' | 'last7' | 'thisMonth' | 'last30' | 'custom';

export interface PeriodRange {
  start: string;
  end: string;
}

/** Inclusive [start, end] range for a preset, anchored to "today" in local time. */
export function rangeForPreset(preset: Exclude<PeriodPreset, 'custom'>, today = todayISO()): PeriodRange {
  switch (preset) {
    case 'today':
      return { start: today, end: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { start: y, end: y };
    }
    case 'last7':
      return { start: addDays(today, -6), end: today };
    case 'last30':
      return { start: addDays(today, -29), end: today };
    case 'thisMonth': {
      const d = parseDateOnly(today);
      const start = toDateOnly(new Date(d.getFullYear(), d.getMonth(), 1));
      return { start, end: today };
    }
  }
}

export function isWithinRange(dateISO: string, range: PeriodRange): boolean {
  return dateISO >= range.start && dateISO <= range.end;
}
