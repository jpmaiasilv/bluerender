import { useState } from 'react';
import { HistoryEntry, isVideoHistoryEntry } from '../../types';
import { historyEntryTitle } from '../../lib/history';
import { useLanguage } from '../../i18n';
import { HistoryEntryPreviewModal } from './HistoryEntryPreviewModal';

interface Props {
  title: string;
  entries: HistoryEntry[];
}

/**
 * Generic "recent generations" strip reused by Imagem por Texto, Gerador de
 * Ideias and Vídeo IA (Render IA keeps its own RecentTests, whose subtitle is
 * settings-specific rather than generic). All four share the same
 * click-to-preview behavior via HistoryEntryPreviewModal.
 *
 * This lives on each tool's own page, not just on /historico, because a
 * generation is charged and written to history the moment it completes on
 * the backend — if the page itself then reloads or errors before the result
 * is opened or downloaded, the already-paid-for output must still be
 * reachable right here without losing the credit spent on it.
 */
export function RecentGenerations({ title, entries }: Props) {
  const { messages } = useLanguage();
  const [previewEntry, setPreviewEntry] = useState<HistoryEntry | null>(null);
  if (entries.length === 0) return null;

  return (
    <div className="mt-8">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-secondary">{title}</h3>
      <div className="flex flex-col gap-2">
        {entries.map((entry) => {
          const creditsLabel = typeof entry.creditsCharged === 'number' ? messages.wallet.creditsSuffix(entry.creditsCharged) : '';

          return (
            <button
              key={`${entry.requestId}-${entry.timestamp}`}
              type="button"
              onClick={() => setPreviewEntry(entry)}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2.5 text-left transition hover:border-sapphire/40 hover:bg-surface-secondary"
            >
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-secondary">
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
                <p className="truncate text-sm text-ink">{historyEntryTitle(entry, messages)}</p>
                <p className="truncate text-xs text-ink-muted">
                  {new Date(entry.timestamp).toLocaleString()} · {(entry.generationTimeMs / 1000).toFixed(1)}s
                  {creditsLabel ? ` · ${creditsLabel}` : ''}
                </p>
              </div>
            </button>
          );
        })}
      </div>
      {previewEntry && <HistoryEntryPreviewModal entry={previewEntry} onClose={() => setPreviewEntry(null)} />}
    </div>
  );
}
