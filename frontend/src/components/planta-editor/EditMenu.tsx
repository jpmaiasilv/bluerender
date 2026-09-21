import { useState } from 'react';
import { ChevronDown, MousePointer2, PenLine } from 'lucide-react';
import { EditorToolMode } from '../../lib/plantaEditor/types';
import { useLanguage } from '../../i18n';

interface Props {
  tool: EditorToolMode;
  onToolChange: (tool: EditorToolMode) => void;
}

/**
 * The spec's "Menu Editar" — most sub-options need an AI model this backend
 * doesn't have yet (object removal/inpainting, outpainting, adding people,
 * material/time-of-day/flooring swaps, shadows, automatic captions). Those
 * are listed and clearly marked "Em breve" rather than hidden, so the full
 * planned feature set stays visible — only "Selecionar" and "Anotar na
 * imagem" (free draw) are wired to a real tool in this MVP.
 */
export function EditMenu({ tool, onToolChange }: Props) {
  const { messages } = useLanguage();
  const t = messages.plantaEditor;
  const [open, setOpen] = useState(false);

  const comingSoonItems = [
    t.editMenu.removeObject,
    t.editMenu.outpaint,
    t.editMenu.addPeople,
    t.editMenu.swapMaterial,
    t.editMenu.changeTimeOfDay,
    t.editMenu.changeFlooring,
    t.editMenu.addShadow,
    t.editMenu.addAutoCaption,
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
      >
        {t.editMenu.title}
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-xl border border-border bg-surface py-1.5 shadow-card">
          <button
            type="button"
            onClick={() => {
              onToolChange('select');
              setOpen(false);
            }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-secondary ${tool === 'select' ? 'text-sapphire' : 'text-ink'}`}
          >
            <MousePointer2 size={14} />
            {t.editMenu.select}
          </button>
          <button
            type="button"
            onClick={() => {
              onToolChange('draw');
              setOpen(false);
            }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-secondary ${tool === 'draw' ? 'text-sapphire' : 'text-ink'}`}
          >
            <PenLine size={14} />
            {t.editMenu.annotate}
          </button>
          <button
            type="button"
            onClick={() => {
              onToolChange('text');
              setOpen(false);
            }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-secondary ${tool === 'text' ? 'text-sapphire' : 'text-ink'}`}
          >
            <PenLine size={14} />
            {t.editMenu.addManualCaption}
          </button>

          <div className="my-1.5 border-t border-border" />

          {comingSoonItems.map((label) => (
            <div
              key={label}
              title={t.editMenu.comingSoon}
              className="flex w-full cursor-not-allowed items-center justify-between px-3 py-2 text-sm text-ink-muted"
            >
              {label}
              <span className="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] font-semibold">{messages.nav.comingSoonBadge}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
