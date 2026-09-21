import { HumanizedFloorplanSimpleHistoryItem } from '../../types';
import { useLanguage } from '../../i18n';
import { formatLocaleDateTime } from '../../lib/formatLocaleDate';

export type HistoryLoadState = 'loading' | 'ready' | 'error';

interface Props {
  items: HumanizedFloorplanSimpleHistoryItem[];
  state: HistoryLoadState;
  onRetry: () => void;
  onOpen: (item: HumanizedFloorplanSimpleHistoryItem) => void;
}

/** Looks a stored value up in a translation table, falling back to "Não informado" for legacy records that predate the field. */
export function labelOrNotInformed(table: Record<string, string>, value: string | null | undefined, notInformed: string): string {
  return value && table[value] ? table[value] : notInformed;
}

/** Cards for the signed-in user's generations, newest first. Data comes from the backend, never from browser storage. */
export function PlantaHumanizadaHistory({ items, state, onRetry, onOpen }: Props) {
  const { messages, locale } = useLanguage();
  const t = messages.plantaHumanizada.simpleFlow;
  const h = t.history;

  const statusStyle: Record<HumanizedFloorplanSimpleHistoryItem['status'], string> = {
    processing: 'bg-amber-100 text-amber-800',
    completed: 'bg-emerald-100 text-emerald-800',
    failed: 'bg-red-100 text-red-700',
  };

  return (
    <section className="border-t border-border bg-surface px-4 py-6 sm:px-6" aria-labelledby="planta-history-title">
      <h2 id="planta-history-title" className="text-base font-semibold text-ink">
        {h.title}
      </h2>

      {state === 'loading' && <p className="mt-4 text-sm text-ink-muted">{h.loading}</p>}

      {state === 'error' && (
        <div className="mt-4 flex items-center gap-3 text-sm text-danger">
          {h.loadError}
          <button type="button" onClick={onRetry} className="rounded-lg border border-border px-3 py-1.5 text-ink hover:bg-surface-secondary">
            {h.retry}
          </button>
        </div>
      )}

      {state === 'ready' && items.length === 0 && <p className="mt-4 text-sm text-ink-muted">{h.empty}</p>}

      {items.length > 0 && (
        <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpen(item)}
                className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-surface text-left transition hover:border-sapphire/50 hover:shadow-card"
              >
                <div className="flex aspect-[4/3] w-full items-center justify-center bg-surface-secondary">
                  {item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-contain" />
                  ) : (
                    <span className="px-3 text-center text-xs text-ink-muted">{h.status[item.status]}</span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-3 text-xs text-ink-secondary">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink-muted">{formatLocaleDateTime(item.createdAt, locale)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusStyle[item.status]}`}>{h.status[item.status]}</span>
                  </div>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold text-ink">{item.generationMode === 'astra' ? h.modeAstra : h.modeStandard}</span>
                  </p>
                  <p className="truncate font-medium text-ink">{labelOrNotInformed(t.styles, item.style, h.notInformed)}</p>
                  <p>
                    {labelOrNotInformed(t.lighting, item.lighting, h.notInformed)} · {labelOrNotInformed(t.surroundings, item.surroundings, h.notInformed)}
                  </p>
                  <p>{item.hasReference ? h.withReference : h.withoutReference}</p>
                  <p>{h.creditsUsed(item.creditsUsed)}</p>
                  {item.originalFileName && <p className="truncate text-ink-muted">{item.originalFileName}</p>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
