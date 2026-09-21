import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { HistoryEntry, isVideoHistoryEntry } from '../../types';
import { historyEntryTitle } from '../../lib/history';
import { useLanguage } from '../../i18n';

interface Props {
  entry: HistoryEntry;
  onClose: () => void;
}

/**
 * Full-size preview for a single history entry — reused by both RecentTests
 * (Render IA's own "recent tests" strip) and HistoryPage, which previously
 * rendered plain, non-interactive rows with no way to see the result at full
 * size or download it. Entries with multiple images (Imagem por Texto /
 * Gerador de Ideias, count 2/4) show the rest as a thumbnail strip the
 * viewer can switch between; imageUrl/images[0] always agree (see
 * HistoryEntry's own doc comment), so the initial image is always correct.
 */
export function HistoryEntryPreviewModal({ entry, onClose }: Props) {
  const { messages } = useLanguage();
  const t = messages.history.preview;
  const isVideo = isVideoHistoryEntry(entry);
  const gallery = !isVideo && entry.images && entry.images.length > 1 ? entry.images : null;
  const [activeUrl, setActiveUrl] = useState(entry.imageUrl);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85 p-5"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <p className="truncate text-sm font-semibold text-ink">{historyEntryTitle(entry, messages)}</p>
          <div className="flex shrink-0 items-center gap-1.5">
            <a
              href={activeUrl}
              download
              title={t.download}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-secondary transition hover:bg-surface-secondary hover:text-ink"
            >
              <Download size={16} />
            </a>
            <button
              type="button"
              onClick={onClose}
              title={t.close}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-secondary transition hover:bg-surface-secondary hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-center overflow-hidden bg-surface-secondary">
          {isVideo ? (
            <video src={activeUrl} controls autoPlay className="max-h-[60vh] w-full" />
          ) : (
            <img src={activeUrl} alt="" className="max-h-[60vh] w-full object-contain" />
          )}
        </div>

        {gallery && (
          <div className="flex gap-2 border-b border-border px-5 py-3">
            {gallery.map((img) => (
              <button
                key={img.requestId}
                type="button"
                onClick={() => setActiveUrl(img.imageUrl)}
                className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 ${
                  activeUrl === img.imageUrl ? 'border-sapphire' : 'border-transparent'
                }`}
              >
                <img src={img.imageUrl} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}

        <div className="overflow-y-auto px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t.prompt}</p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-secondary">{entry.prompt}</p>
        </div>
      </div>
    </div>,
    document.body
  );
}
