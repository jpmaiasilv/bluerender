import { useState } from 'react';
import { HistoryEntry, isRenderHistoryEntry } from '../types';
import { useLanguage } from '../i18n';
import { HistoryEntryPreviewModal } from './history/HistoryEntryPreviewModal';

interface Props {
  entries: HistoryEntry[];
}

export function RecentTests({ entries }: Props) {
  const { messages } = useLanguage();
  const [previewEntry, setPreviewEntry] = useState<HistoryEntry | null>(null);
  // "Recent tests" has always meant Render IA's own history — filtering here
  // keeps that true now that the same localStorage log also holds entries
  // from other tools (e.g. Imagem por Texto).
  const renderEntries = entries.filter(isRenderHistoryEntry);
  if (renderEntries.length === 0) return null;

  return (
    <div className="mt-8">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-secondary">{messages.history.recentTests}</h3>
      <div className="flex flex-col gap-2">
        {renderEntries.map((entry) => {
          // Entries saved by an older version of the app may lack renderStyle/aspectRatio.
          const styleLabel = entry.settings.renderStyle
            ? messages.fields.renderStyles[entry.settings.renderStyle] ?? entry.settings.renderStyle
            : '';
          const projectTypeLabel = entry.settings.projectType
            ? messages.fields.projectTypeOptions[entry.settings.projectType] ?? entry.settings.projectType
            : '';
          const lightingLabel = entry.settings.lighting
            ? messages.fields.lightingOptions[entry.settings.lighting] ?? entry.settings.lighting
            : '';
          const engineLabel = entry.engine
            ? (messages.engines.tierNames as Record<string, string>)[entry.engine] ?? entry.engine
            : '';
          const creditsLabel =
            typeof entry.creditsCharged === 'number' ? messages.wallet.creditsSuffix(entry.creditsCharged) : '';

          return (
            <button
              key={`${entry.requestId}-${entry.timestamp}`}
              type="button"
              onClick={() => setPreviewEntry(entry)}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2.5 text-left transition hover:border-sapphire/40 hover:bg-surface-secondary"
            >
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-secondary">
                <img
                  src={entry.imageUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">
                  {[projectTypeLabel, styleLabel, lightingLabel].filter(Boolean).join(' · ')}
                </p>
                <p className="truncate text-xs text-ink-muted">
                  {new Date(entry.timestamp).toLocaleString()} · {(entry.generationTimeMs / 1000).toFixed(1)}s
                  {engineLabel ? ` · ${engineLabel}` : ''}
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
