import { useEffect, useRef, useState } from 'react';
import { LayoutGrid, List, Search, SlidersHorizontal } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { PROJECT_PRIORITIES, ProjectPriority } from '../../lib/projects/types';

export type StatusFilterKey = 'all' | 'onTrack' | 'dueSoon' | 'overdue' | 'waitingForClient' | 'completed';

const STATUS_FILTERS: StatusFilterKey[] = ['all', 'onTrack', 'dueSoon', 'overdue', 'waitingForClient', 'completed'];

interface Props {
  statusFilter: StatusFilterKey;
  onStatusFilterChange: (key: StatusFilterKey) => void;
  priorityFilter: ProjectPriority | 'all';
  onPriorityFilterChange: (p: ProjectPriority | 'all') => void;
  search: string;
  onSearchChange: (v: string) => void;
  view: 'board' | 'list';
  onViewChange: (v: 'board' | 'list') => void;
  showArchived: boolean;
  onShowArchivedChange: (v: boolean) => void;
}

export function FiltersBar({
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  search,
  onSearchChange,
  view,
  onViewChange,
  showArchived,
  onShowArchivedChange,
}: Props) {
  const { messages } = useLanguage();
  const t = messages.projectFlow;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filtersOpen) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setFiltersOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [filtersOpen]);

  return (
    <div className="flex flex-col gap-3 border-b border-border px-6 py-4 lg:px-8">
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onStatusFilterChange(key)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              statusFilter === key ? 'border-sapphire bg-sapphire-light text-sapphire' : 'border-border bg-surface text-ink-secondary hover:border-sapphire/40'
            }`}
          >
            {t.statusFilters[key]}
          </button>
        ))}

        <div ref={ref} className="relative">
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              priorityFilter !== 'all' ? 'border-sapphire bg-sapphire-light text-sapphire' : 'border-border bg-surface text-ink-secondary hover:border-sapphire/40'
            }`}
          >
            <SlidersHorizontal size={13} />
            {t.filters.label}
          </button>
          {filtersOpen && (
            <div className="absolute left-0 top-9 z-20 w-56 rounded-lg border border-border bg-surface p-3 shadow-lg">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.filters.priority}</span>
              <div className="mb-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => onPriorityFilterChange('all')}
                  className={`rounded-full px-2 py-1 text-xs font-medium ${priorityFilter === 'all' ? 'bg-sapphire text-white' : 'bg-surface-secondary text-ink-secondary'}`}
                >
                  {t.statusFilters.all}
                </button>
                {PROJECT_PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => onPriorityFilterChange(p)}
                    className={`rounded-full px-2 py-1 text-xs font-medium ${priorityFilter === p ? 'bg-sapphire text-white' : 'bg-surface-secondary text-ink-secondary'}`}
                  >
                    {t.priority.options[p]}
                  </button>
                ))}
              </div>
              <label className="flex items-center justify-between border-t border-border pt-2 text-xs text-ink-secondary">
                {t.filters.showArchived}
                <input type="checkbox" checked={showArchived} onChange={(e) => onShowArchivedChange(e.target.checked)} className="accent-sapphire" />
              </label>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <div className="flex gap-1 rounded-lg border border-border bg-surface-secondary p-1">
          <button
            type="button"
            onClick={() => onViewChange('board')}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
              view === 'board' ? 'bg-sapphire text-white shadow-sm' : 'text-ink-secondary hover:text-sapphire'
            }`}
          >
            <LayoutGrid size={13} />
            {t.view.board}
          </button>
          <button
            type="button"
            onClick={() => onViewChange('list')}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
              view === 'list' ? 'bg-sapphire text-white shadow-sm' : 'text-ink-secondary hover:text-sapphire'
            }`}
          >
            <List size={13} />
            {t.view.list}
          </button>
        </div>
      </div>
    </div>
  );
}
