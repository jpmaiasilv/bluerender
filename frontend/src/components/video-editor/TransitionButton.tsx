import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { EditorTransitionType } from '../../types';
import { useLanguage } from '../../i18n';

const OPTIONS: EditorTransitionType[] = ['none', 'fade', 'dissolve', 'slide', 'zoom'];

interface Props {
  afterClipId: string;
  currentType: EditorTransitionType;
  active: boolean;
  onSelect: () => void;
  onChange: (type: EditorTransitionType) => void;
}

export function TransitionButton({ afterClipId: _afterClipId, currentType, active, onSelect, onChange }: Props) {
  const { messages } = useLanguage();
  const t = messages.videoEditor.panel.transition.options;
  const hasTransition = currentType !== 'none';
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const labelFor = (type: EditorTransitionType) => t[type];

  return (
    <div ref={ref} className="relative flex items-center justify-center">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
          setOpen((v) => !v);
        }}
        title={hasTransition ? messages.videoEditor.timeline.editTransition : messages.videoEditor.timeline.addTransition}
        className={`flex h-7 w-7 items-center justify-center rounded-full border-2 shadow-md transition ${
          hasTransition || active
            ? 'border-sapphire bg-sapphire text-white'
            : 'border-sapphire/40 bg-white text-sapphire/70 hover:border-sapphire hover:bg-sapphire-soft hover:text-sapphire'
        }`}
      >
        <Sparkles size={13} />
      </button>
      {open && (
        <div className="absolute top-8 left-1/2 z-20 w-40 -translate-x-1/2 rounded-lg border border-border bg-surface py-1 shadow-lg">
          {OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(option);
                setOpen(false);
              }}
              className={`block w-full px-3 py-1.5 text-left text-xs transition hover:bg-sapphire-soft hover:text-sapphire ${
                option === currentType ? 'font-medium text-sapphire' : 'text-ink-secondary'
              }`}
            >
              {labelFor(option)}
            </button>
          ))}
          <div className="mt-1 border-t border-border px-3 pt-1 text-[10px] text-ink-muted">0.5s</div>
        </div>
      )}
    </div>
  );
}
