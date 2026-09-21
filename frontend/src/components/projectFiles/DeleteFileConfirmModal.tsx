import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '../Modal';
import { useLanguage } from '../../i18n';
import { ProjectFile } from '../../lib/projectFiles/types';

interface Props {
  file: ProjectFile | null;
  onClose: () => void;
  onConfirm: (file: ProjectFile) => Promise<void>;
}

export function DeleteFileConfirmModal({ file, onClose, onConfirm }: Props) {
  const { messages } = useLanguage();
  const t = messages.projectFiles.deleteConfirm;
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(false);

  function handleClose() {
    if (deleting) return;
    setError(false);
    onClose();
  }

  async function handleConfirm() {
    if (!file || deleting) return;
    setDeleting(true);
    setError(false);
    try {
      await onConfirm(file);
      onClose();
    } catch {
      setError(true);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal open={file !== null} onClose={handleClose} labelledBy="delete-file-title" panelClassName="w-full max-w-[400px]">
      {file && (
        <div className="flex flex-col gap-4 px-6 py-6">
          <div>
            <h2 id="delete-file-title" className="text-base font-semibold text-ink">
              {t.title}
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">{t.body}</p>
            <p className="mt-2 truncate text-sm font-medium text-ink">{file.name}</p>
          </div>
          {error && <p className="text-sm text-danger">{t.errorGeneric}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={deleting}
              className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink-secondary transition hover:border-sapphire/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t.cancel}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={deleting}
              className="flex items-center gap-1.5 rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleting && <Loader2 size={14} className="animate-spin" />}
              {deleting ? t.deleting : t.confirm}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
