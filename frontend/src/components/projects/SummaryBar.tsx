import { useLanguage } from '../../i18n';
import { formatMoneyCents } from '../../lib/financial/money';

interface Props {
  activeCount: number;
  overdueCount: number;
  dueThisWeekCount: number;
  receivableCents: number;
}

export function SummaryBar({ activeCount, overdueCount, dueThisWeekCount, receivableCents }: Props) {
  const { messages, locale } = useLanguage();
  const t = messages.projectFlow.summary;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 pb-2 text-xs text-ink-secondary lg:px-8">
      <span>
        <span className="font-semibold text-ink">{activeCount}</span> {t.active}
      </span>
      <span className="text-border">·</span>
      <span className={overdueCount > 0 ? 'text-danger' : ''}>
        <span className="font-semibold">{overdueCount}</span> {t.overdue}
      </span>
      <span className="text-border">·</span>
      <span>
        <span className="font-semibold text-ink">{dueThisWeekCount}</span> {t.dueThisWeek}
      </span>
      <span className="text-border">·</span>
      <span>
        <span className="font-semibold text-ink">{formatMoneyCents(receivableCents, locale)}</span> {t.receivable}
      </span>
    </div>
  );
}
