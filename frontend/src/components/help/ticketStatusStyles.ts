import { SupportStatus } from '../../lib/support/types';

/** Deliberately discreet — a small set of soft tones. Mirrors
 * components/projects/dueStatusStyles.ts. */
export const TICKET_STATUS_STYLES: Record<SupportStatus, { dot: string; bg: string; text: string }> = {
  submitted: { dot: 'bg-sapphire', bg: 'bg-sapphire-light', text: 'text-sapphire' },
  in_review: { dot: 'bg-warning', bg: 'bg-warning/10', text: 'text-warning' },
  answered: { dot: 'bg-success', bg: 'bg-success/10', text: 'text-success' },
  resolved: { dot: 'bg-ink-muted', bg: 'bg-surface-secondary', text: 'text-ink-secondary' },
};
