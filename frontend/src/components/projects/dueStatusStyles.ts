import { DueStatus } from '../../lib/projects/types';

/** Deliberately discreet — a small set of soft tones, never a "rainbow"
 * board (see spec section 13). Reused by the card badge and the detail panel. */
export const DUE_STATUS_STYLES: Record<DueStatus, { dot: string; bg: string; text: string }> = {
  onTrack: { dot: 'bg-success', bg: 'bg-success/10', text: 'text-success' },
  dueSoon: { dot: 'bg-warning', bg: 'bg-warning/10', text: 'text-warning' },
  dueToday: { dot: 'bg-amber-500', bg: 'bg-amber-50', text: 'text-amber-600' },
  overdue: { dot: 'bg-danger', bg: 'bg-danger/10', text: 'text-danger' },
  completed: { dot: 'bg-sapphire', bg: 'bg-sapphire-light', text: 'text-sapphire' },
};

export const PRIORITY_DOT_COLOR: Record<string, string> = {
  low: 'bg-ink-muted',
  normal: 'bg-sapphire/50',
  high: 'bg-warning',
  urgent: 'bg-danger',
};
