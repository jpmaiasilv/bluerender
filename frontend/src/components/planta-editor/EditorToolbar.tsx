import { useState } from 'react';
import { ArrowLeft, Copy, Download, Hand, MousePointer2, Redo2, Save, Trash2, Undo2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EditorToolMode } from '../../lib/plantaEditor/types';
import { useLanguage } from '../../i18n';

interface Props {
  tool: EditorToolMode;
  onToolChange: (tool: EditorToolMode) => void;
  hasSelection: boolean;
  onErase: () => void;
  onCopy: () => void;
  onSave: () => void;
  justSaved: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExportPng: () => void;
  onExportJpg: () => void;
  onExportPdf: () => void;
}

/** Top bar: Selecionar/Mover (also reachable from the tools panel) plus Apagar/Copiar/Salvar/Desfazer/Refazer/Exportar — the "barra de ferramentas principal" from the spec. */
export function EditorToolbar({
  tool,
  onToolChange,
  hasSelection,
  onErase,
  onCopy,
  onSave,
  justSaved,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onExportPng,
  onExportJpg,
  onExportPdf,
}: Props) {
  const { messages } = useLanguage();
  const t = messages.plantaEditor;
  const [exportOpen, setExportOpen] = useState(false);

  const btnClass = (active: boolean) =>
    `flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${
      active ? 'border-sapphire bg-sapphire-light text-sapphire' : 'border-border bg-surface text-ink-secondary hover:border-sapphire/40 hover:text-ink'
    }`;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
      <Link
        to="/planta-humanizada"
        className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium text-ink-secondary transition hover:bg-surface-secondary"
        title={t.backToPlanta}
      >
        <ArrowLeft size={16} />
      </Link>

      <div className="h-6 w-px bg-border" />

      <button type="button" className={btnClass(tool === 'select')} onClick={() => onToolChange('select')}>
        <MousePointer2 size={15} />
        {t.toolbar.select}
      </button>
      <button type="button" className={btnClass(tool === 'move')} onClick={() => onToolChange('move')}>
        <Hand size={15} />
        {t.toolbar.move}
      </button>

      <div className="h-6 w-px bg-border" />

      <button type="button" disabled={!hasSelection} onClick={onErase} className={`${btnClass(false)} disabled:cursor-not-allowed disabled:opacity-40`}>
        <Trash2 size={15} />
        {t.toolbar.erase}
      </button>
      <button type="button" disabled={!hasSelection} onClick={onCopy} className={`${btnClass(false)} disabled:cursor-not-allowed disabled:opacity-40`}>
        <Copy size={15} />
        {t.toolbar.copy}
      </button>

      <div className="h-6 w-px bg-border" />

      <button type="button" disabled={!canUndo} onClick={onUndo} className={`${btnClass(false)} disabled:cursor-not-allowed disabled:opacity-40`} title={t.toolbar.undo}>
        <Undo2 size={15} />
      </button>
      <button type="button" disabled={!canRedo} onClick={onRedo} className={`${btnClass(false)} disabled:cursor-not-allowed disabled:opacity-40`} title={t.toolbar.redo}>
        <Redo2 size={15} />
      </button>

      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={onSave} className={btnClass(false)}>
          <Save size={15} />
          {justSaved ? t.toolbar.saved : t.toolbar.save}
        </button>

        <div className="relative">
          <button type="button" onClick={() => setExportOpen((v) => !v)} className="flex items-center gap-1.5 rounded-lg bg-sapphire px-3 py-2 text-sm font-semibold text-white transition hover:bg-sapphire-hover">
            <Download size={15} />
            {t.toolbar.export}
          </button>
          {exportOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 w-40 rounded-lg border border-border bg-surface py-1 shadow-card">
              {[
                { label: t.toolbar.exportPng, onClick: onExportPng },
                { label: t.toolbar.exportJpg, onClick: onExportJpg },
                { label: t.toolbar.exportPdf, onClick: onExportPdf },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    item.onClick();
                    setExportOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-surface-secondary"
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
