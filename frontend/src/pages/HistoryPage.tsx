import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ToolLayout } from '../components/ToolLayout';
import { HistoryEntryPreviewModal } from '../components/history/HistoryEntryPreviewModal';
import { historyEntryTitle, loadHistory } from '../lib/history';
import { HistoryEntry, HistoryToolId, isVideoHistoryEntry } from '../types';
import { useLanguage } from '../i18n';

type FilterKey = 'all' | HistoryToolId;

function isFilterKey(value: string | null): value is FilterKey {
  return (
    value === 'all' ||
    value === 'render' ||
    value === 'plantaHumanizada' ||
    value === 'imagemPorTexto' ||
    value === 'ideaGenerator' ||
    value === 'upscale' ||
    value === 'videoIa'
  );
}

const FILTERS: { key: FilterKey; messageKey: keyof ReturnType<typeof useLanguage>['messages']['history']['filters'] | 'all' }[] = [
  { key: 'all', messageKey: 'all' },
  { key: 'render', messageKey: 'renders' },
  { key: 'plantaHumanizada', messageKey: 'plants' },
  { key: 'imagemPorTexto', messageKey: 'textImages' },
  { key: 'ideaGenerator', messageKey: 'ideas' },
  { key: 'upscale', messageKey: 'upscales' },
  { key: 'videoIa', messageKey: 'videos' },
];

export function HistoryPage() {
  const { messages } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const toolParam = searchParams.get('tool');
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [filter, setFilter] = useState<FilterKey>(isFilterKey(toolParam) ? toolParam : 'all');
  const [previewEntry, setPreviewEntry] = useState<HistoryEntry | null>(null);

  useEffect(() => {
    setEntries(loadHistory());
  }, []);

  function handleFilterChange(next: FilterKey) {
    setFilter(next);
    if (next === 'all') {
      searchParams.delete('tool');
    } else {
      searchParams.set('tool', next);
    }
    setSearchParams(searchParams, { replace: true });
  }

  const filtered = filter === 'all' ? entries : entries.filter((e) => e.toolId === filter);

  return (
    <ToolLayout title={messages.history.title} description={messages.history.subtitle}>
      <div className="px-8 py-6">
        <div className="mb-6 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => handleFilterChange(f.key)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                filter === f.key
                  ? 'border-sapphire bg-sapphire-light text-sapphire'
                  : 'border-border bg-surface text-ink-secondary hover:border-sapphire/40'
              }`}
            >
              {messages.history.filters[f.messageKey as keyof typeof messages.history.filters]}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-ink-muted">{messages.history.empty}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((entry) => (
              <button
                key={`${entry.requestId}-${entry.timestamp}`}
                type="button"
                onClick={() => setPreviewEntry(entry)}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left shadow-card transition hover:border-sapphire/40 hover:bg-surface-secondary"
              >
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-secondary">
                  {isVideoHistoryEntry(entry) ? (
                    <video src={entry.imageUrl} className="h-full w-full object-cover" muted />
                  ) : (
                    <img
                      src={entry.imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                  {entry.images && entry.images.length > 1 && (
                    <span className="absolute bottom-0.5 right-0.5 rounded bg-ink/70 px-1 text-[10px] font-medium text-white">
                      ×{entry.images.length}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{historyEntryTitle(entry, messages)}</p>
                  <p className="truncate text-xs text-ink-muted">
                    {new Date(entry.timestamp).toLocaleString()} · {(entry.generationTimeMs / 1000).toFixed(1)}s ·{' '}
                    {messages.wallet.creditsSuffix(entry.creditsCharged)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {previewEntry && <HistoryEntryPreviewModal entry={previewEntry} onClose={() => setPreviewEntry(null)} />}
    </ToolLayout>
  );
}
