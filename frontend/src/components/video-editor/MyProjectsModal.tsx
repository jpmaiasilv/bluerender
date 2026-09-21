import { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { useLanguage } from '../../i18n';
import { loadHistory } from '../../lib/history';
import { isVideoHistoryEntry } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (url: string, kind: 'video' | 'image') => Promise<void>;
}

export function MyProjectsModal({ open, onClose, onAdd }: Props) {
  const { messages } = useLanguage();
  const t = messages.videoEditor.myProjectsModal;
  const [addingUrl, setAddingUrl] = useState<string | null>(null);

  const entries = useMemo(() => (open ? loadHistory().slice(0, 60) : []), [open]);

  return (
    <Modal open={open} onClose={onClose} labelledBy="my-projects-modal-title" panelClassName="w-full max-w-[820px]">
      <div className="flex max-h-[80vh] flex-col">
        <div className="border-b border-border px-6 py-4">
          <h2 id="my-projects-modal-title" className="text-base font-semibold text-ink">
            {t.title}
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {entries.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-muted">{t.empty}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {entries.map((entry) => {
                const isVideo = isVideoHistoryEntry(entry);
                const key = `${entry.requestId}-${entry.timestamp}`;
                return (
                  <div key={key} className="group relative overflow-hidden rounded-xl border border-border bg-surface-secondary">
                    {isVideo ? (
                      <video src={entry.imageUrl} muted className="h-28 w-full object-cover" />
                    ) : (
                      <img src={entry.imageUrl} alt={entry.prompt} className="h-28 w-full object-cover" />
                    )}
                    <button
                      type="button"
                      disabled={addingUrl === entry.imageUrl}
                      onClick={async () => {
                        setAddingUrl(entry.imageUrl);
                        try {
                          await onAdd(entry.imageUrl, isVideo ? 'video' : 'image');
                        } finally {
                          setAddingUrl(null);
                        }
                      }}
                      className="absolute inset-0 flex items-center justify-center bg-ink/0 text-xs font-medium text-white opacity-0 transition group-hover:bg-ink/50 group-hover:opacity-100"
                    >
                      {addingUrl === entry.imageUrl ? '...' : t.add}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
