import { addMonths, addDays } from './dates';
import { RecurrenceFrequency } from './types';

/** Bounded on purpose — "generate as needed, never infinitely" (per spec).
 * A recurring series materializes up to this many occurrences at creation
 * time; extending an existing series further is a future "renew" action,
 * not an open-ended background job. 12 covers a full year of a monthly
 * bill, which is the only frequency exposed in the UI today. */
export const MAX_GENERATED_OCCURRENCES = 12;

function advance(dateISO: string, frequency: RecurrenceFrequency, interval: number): string {
  switch (frequency) {
    case 'weekly':
      return addDays(dateISO, 7 * interval);
    case 'yearly':
      return addMonths(dateISO, 12 * interval);
    case 'monthly':
    default:
      return addMonths(dateISO, interval);
  }
}

/** Returns the transactionDate for each occurrence after the first
 * (the first occurrence is the transaction the user is creating directly —
 * this only generates the *following* ones), stopping at endDate or
 * MAX_GENERATED_OCCURRENCES, whichever comes first. */
export function generateFollowingOccurrenceDates(
  startDate: string,
  frequency: RecurrenceFrequency,
  interval: number,
  endDate: string | null
): string[] {
  const dates: string[] = [];
  let current = startDate;
  for (let i = 0; i < MAX_GENERATED_OCCURRENCES; i++) {
    current = advance(current, frequency, Math.max(1, interval));
    if (endDate && current > endDate) break;
    dates.push(current);
  }
  return dates;
}
