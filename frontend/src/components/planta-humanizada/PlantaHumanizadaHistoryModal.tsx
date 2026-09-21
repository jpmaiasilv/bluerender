import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { CompareSlider } from '../CompareSlider';
import { HumanizedFloorplanSimpleHistoryItem } from '../../types';
import { useLanguage } from '../../i18n';
import { formatLocaleDateTime } from '../../lib/formatLocaleDate';
import { labelOrNotInformed } from './PlantaHumanizadaHistory';

type Tab = 'result' | 'original' | 'compare';

interface Props {
  item: HumanizedFloorplanSimpleHistoryItem | null;
  onClose: () => void;
  onNewVersion: (item: HumanizedFloorplanSimpleHistoryItem) => void;
  onRepeat: (item: HumanizedFloorplanSimpleHistoryItem) => void;
  onDelete: (item: HumanizedFloorplanSimpleHistoryItem) => Promise<void>;
}

/** Viewer for one past generation: result / original / before-after, downloads, and the reuse + delete actions. */
export function PlantaHumanizadaHistoryModal({ item, onClose, onNewVersion, onRepeat, onDelete }: Props) {
  const { messages, locale } = useLanguage();
  const t = messages.plantaHumanizada.simpleFlow;
  const m = t.modal;
  const [tab, setTab] = useState<Tab>('result');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  useEffect(() => {
    setTab('result');
    setDeleting(false);
    setDeleteError(false);
  }, [item?.id]);

  if (!item) return null;

  const completed = item.status === 'completed' && item.resultUrl;
  const tabs: Array<{ id: Tab; label: string; enabled: boolean }> = [
    { id: 'result', label: m.tabResult, enabled: Boolean(item.resultUrl) },
    { id: 'original', label: m.tabOriginal, enabled: Boolean(item.originalUrl) },
    { id: 'compare', label: m.tabCompare, enabled: Boolean(item.resultUrl && item.originalUrl) },
  ];
  const actionButton = 'rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-ink transition hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-60';

  async function handleDelete() {
    if (!item || !window.confirm(m.deleteConfirm)) return;
    setDeleting(true);
    setDeleteError(false);
    try {
      await onDelete(item);
    } catch {
      setDeleteError(true);
      setDeleting(false);
    }
  }

  return (
    <Modal open onClose={onClose} labelledBy="planta-history-modal-title" panelClassName="w-full max-w-[960px]">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5 sm:p-6">
        <h3 id="planta-history-modal-title" className="pr-10 text-base font-semibold text-ink">
          {m.title} · {formatLocaleDateTime(item.createdAt, locale)}
        </h3>
        <p className="mt-1 text-xs text-ink-muted">
          {item.generationMode === 'astra' ? t.history.modeAstra : t.history.modeStandard} · {labelOrNotInformed(t.styles, item.style, t.history.notInformed)} · {labelOrNotInformed(t.lighting, item.lighting, t.history.notInformed)} ·{' '}
          {labelOrNotInformed(t.surroundings, item.surroundings, t.history.notInformed)} · {t.history.status[item.status]} · {t.history.creditsUsed(item.creditsUsed)}
        </p>
        {item.status === 'failed' && <p className="mt-2 text-sm text-danger">{t.failureNoCharge}</p>}

        <div className="mt-4 flex gap-2" role="tablist">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              role="tab"
              aria-selected={tab === tb.id}
              disabled={!tb.enabled}
              onClick={() => setTab(tb.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                tab === tb.id ? 'bg-sapphire/10 text-sapphire' : 'text-ink-secondary hover:text-ink'
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex min-h-[220px] items-center justify-center rounded-xl bg-surface-secondary p-2">
          {tab === 'result' && item.resultUrl && <img src={item.resultUrl} alt={m.tabResult} className="max-h-[60vh] w-full object-contain" />}
          {tab === 'original' && item.originalUrl && <img src={item.originalUrl} alt={m.tabOriginal} className="max-h-[60vh] w-full object-contain" />}
          {tab === 'compare' && item.resultUrl && item.originalUrl && (
            <div className="w-full">
              <CompareSlider beforeSrc={item.originalUrl} afterSrc={item.resultUrl} beforeLabel={m.before} afterLabel={m.after} />
            </div>
          )}
          {!item.resultUrl && !item.originalUrl && <span className="text-sm text-ink-muted">{m.noImage}</span>}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {completed && item.downloadPngUrl && (
            <a href={item.downloadPngUrl} download className="rounded-lg bg-sapphire px-3 py-2 text-sm font-semibold text-white transition hover:bg-sapphire-hover">
              {t.downloadPng}
            </a>
          )}
          {completed && item.downloadJpgUrl && (
            <a href={item.downloadJpgUrl} download className={actionButton}>
              {t.downloadJpg}
            </a>
          )}
          {item.originalUrl && (
            <>
              <button type="button" onClick={() => onNewVersion(item)} className={actionButton}>
                {m.newVersion}
              </button>
              <button type="button" onClick={() => onRepeat(item)} className={actionButton}>
                {m.repeat}
              </button>
            </>
          )}
          <button type="button" onClick={handleDelete} disabled={deleting || item.status === 'processing'} className={`${actionButton} ml-auto text-danger`}>
            {m.deleteAction}
          </button>
        </div>
        {deleteError && <p className="mt-2 text-xs text-danger">{m.deleteFailed}</p>}
      </div>
    </Modal>
  );
}
