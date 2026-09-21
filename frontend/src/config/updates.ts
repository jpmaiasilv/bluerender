/**
 * Structural data only — mirrors config/plans.ts's split: this file holds the
 * id/tag/date for each update, the actual title/description copy lives in
 * i18n (messages.helpPage.updates.items[id]) so it's translated like every
 * other user-facing string. Not database-backed yet (see HelpPage.tsx) — the
 * shape (id-keyed, ordered array) is deliberately easy to swap for a Supabase
 * query later without touching the component that renders it.
 */

export type UpdateTag = 'new' | 'improvement' | 'comingSoon' | 'fix';

export interface UpdateItem {
  id: string;
  tag: UpdateTag;
  /** ISO date (yyyy-mm-dd). */
  date: string;
}

/** Newest first. */
export const UPDATES: UpdateItem[] = [
  { id: 'annualPlans', tag: 'new', date: '2026-08-20' },
  { id: 'moreToolsComing', tag: 'improvement', date: '2026-08-10' },
  { id: 'renderUltra', tag: 'comingSoon', date: '2026-07-28' },
  { id: 'advancedVideoIa', tag: 'comingSoon', date: '2026-07-28' },
];
