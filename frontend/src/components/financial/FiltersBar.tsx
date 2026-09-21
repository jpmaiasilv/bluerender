import { ReactNode, useState } from 'react';
import { Search } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { PeriodPreset, PeriodRange, rangeForPreset, todayISO } from '../../lib/financial/dates';
import { TransactionType } from '../../lib/financial/types';

interface Props {
  preset: PeriodPreset;
  range: PeriodRange;
  onPresetChange: (preset: PeriodPreset, range: PeriodRange) => void;
  onCustomRangeChange: (range: PeriodRange) => void;
  typeFilter: TransactionType | 'all';
  onTypeFilterChange: (type: TransactionType | 'all') => void;
  search: string;
  onSearchChange: (value: string) => void;
  /** The "Filtros" (advanced filters) trigger — kept as an injected slot so this toolbar doesn't need to know about client/project/category/status/payment-method filtering itself. */
  extraControls?: ReactNode;
}

const PRESETS: PeriodPreset[] = ['today', 'yesterday', 'last7', 'thisMonth', 'last30', 'custom'];

export function FiltersBar({
  preset,
  range,
  onPresetChange,
  onCustomRangeChange,
  typeFilter,
  onTypeFilterChange,
  search,
  onSearchChange,
  extraControls,
}: Props) {
  const { messages } = useLanguage();
  const t = messages.financial;
  const [customOpen, setCustomOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3 border-b border-border px-6 py-4 lg:px-8">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              if (p === 'custom') {
                setCustomOpen((v) => !v);
                return;
              }
              setCustomOpen(false);
              onPresetChange(p, rangeForPreset(p));
            }}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              preset === p ? 'border-sapphire bg-sapphire-light text-sapphire' : 'border-border bg-surface text-ink-secondary hover:border-sapphire/40'
            }`}
          >
            {t.periods[p]}
          </button>
        ))}
      </div>

      {customOpen && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface-secondary p-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-secondary">{t.periods.from}</span>
            <input
              type="date"
              value={range.start}
              max={range.end}
              onChange={(e) => onCustomRangeChange({ start: e.target.value, end: range.end })}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-sapphire"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-secondary">{t.periods.to}</span>
            <input
              type="date"
              value={range.end}
              min={range.start}
              max={todayISO()}
              onChange={(e) => onCustomRangeChange({ start: range.start, end: e.target.value })}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-sapphire"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              onPresetChange('custom', range);
              setCustomOpen(false);
            }}
            className="rounded-lg bg-sapphire px-3 py-1.5 text-sm font-medium text-white transition hover:bg-sapphire-hover"
          >
            {t.periods.apply}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {extraControls}
        <div className="flex gap-1 rounded-lg border border-border bg-surface-secondary p-1">
          {(['all', 'income', 'expense'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onTypeFilterChange(v)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                typeFilter === v ? 'bg-sapphire text-white shadow-sm' : 'text-ink-secondary hover:text-sapphire'
              }`}
            >
              {t.typeFilter[v]}
            </button>
          ))}
        </div>
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="w-full rounded-lg border border-border bg-surface py-1.5 pl-8 pr-3 text-sm text-ink outline-none transition focus:border-sapphire focus:ring-1 focus:ring-sapphire"
          />
        </div>
      </div>
    </div>
  );
}
