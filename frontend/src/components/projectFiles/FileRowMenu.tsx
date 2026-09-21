import { useEffect, useRef, useState } from 'react';
import { Download, Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { ProjectFile } from '../../lib/projectFiles/types';

interface Props {
  file: ProjectFile;
  canPreview: boolean;
  onView: (file: ProjectFile) => void;
  onDownload: (file: ProjectFile) => void;
  onEdit: (file: ProjectFile) => void;
  onDelete: (file: ProjectFile) => void;
}

/** Mirrors components/financial/TransactionsTable.tsx's RowMenu exactly (same positioning, outside-click handling and styling). */
export function FileRowMenu({ file, canPreview, onView, onDownload, onEdit, onDelete }: Props) {
  const { messages } = useLanguage();
  const t = messages.projectFiles.actions;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition hover:bg-surface-secondary hover:text-ink"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 w-44 rounded-lg border border-border bg-surface py-1 shadow-lg">
          {canPreview && (
            <button
              type="button"
              onClick={() => {
                onView(file);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-sapphire-soft hover:text-sapphire"
            >
              <Eye size={13} />
              {t.view}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onDownload(file);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-sapphire-soft hover:text-sapphire"
          >
            <Download size={13} />
            {t.download}
          </button>
          <button
            type="button"
            onClick={() => {
              onEdit(file);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink-secondary hover:bg-sapphire-soft hover:text-sapphire"
          >
            <Pencil size={13} />
            {t.edit}
          </button>
          <button
            type="button"
            onClick={() => {
              onDelete(file);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-danger hover:bg-danger/10"
          >
            <Trash2 size={13} />
            {t.delete}
          </button>
        </div>
      )}
    </div>
  );
}
