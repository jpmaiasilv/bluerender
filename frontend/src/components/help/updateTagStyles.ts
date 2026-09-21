import { UpdateTag } from '../../config/updates';

/** Mirrors ticketStatusStyles.ts / components/projects/dueStatusStyles.ts. */
export const UPDATE_TAG_STYLES: Record<UpdateTag, { bg: string; text: string }> = {
  new: { bg: 'bg-success/10', text: 'text-success' },
  improvement: { bg: 'bg-sapphire-light', text: 'text-sapphire' },
  comingSoon: { bg: 'bg-warning/10', text: 'text-warning' },
  fix: { bg: 'bg-surface-secondary', text: 'text-ink-secondary' },
};
