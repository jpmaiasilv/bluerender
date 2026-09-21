// Reuses the same date-only ("YYYY-MM-DD") helpers as the Financial module
// (lib/financial/dates.ts) rather than duplicating them — local calendar
// fields only, never Date.toISOString()'s UTC serialization, so a due date
// of "26/08" never silently reads back as "25/08" in a negative-UTC
// timezone.
import { daysBetween, todayISO } from '../financial/dates';
import { DueStatus } from './types';

export { todayISO, daysBetween, toDateOnly, parseDateOnly, addDays } from '../financial/dates';

/** How many days ahead of the due date counts as "coming up soon". */
const DUE_SOON_WINDOW_DAYS = 3;

export function deriveDueStatus(
  project: { dueDate: string | null; completedAt: string | null },
  today = todayISO()
): DueStatus {
  if (project.completedAt) return 'completed';
  if (!project.dueDate) return 'onTrack';
  const diff = daysBetween(today, project.dueDate); // positive = due date is in the future
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'dueToday';
  if (diff <= DUE_SOON_WINDOW_DAYS) return 'dueSoon';
  return 'onTrack';
}

/** Days spent so far in the current stage — always >= 0. */
export function daysInStage(stageEnteredAt: string, today = todayISO()): number {
  const enteredDate = stageEnteredAt.slice(0, 10);
  return Math.max(0, daysBetween(enteredDate, today));
}
