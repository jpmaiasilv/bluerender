import { Image as ImageIcon, Sparkles } from 'lucide-react';
import { IDEA_EXAMPLE_PRESETS, IdeaExamplePreset } from '../../lib/ideaExamples';
import { useLanguage } from '../../i18n';

interface Props {
  onCreateNew: () => void;
  onReimagine: () => void;
  onExampleSelected: (preset: IdeaExamplePreset) => void;
}

export function IdeaEmptyState({ onCreateNew, onReimagine, onExampleSelected }: Props) {
  const { messages } = useLanguage();
  const t = messages.ideaGenerator.emptyState;

  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-secondary px-8 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sapphire-light">
        <Sparkles size={22} className="text-sapphire" />
      </div>
      <p className="text-base font-medium text-ink">{t.title}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-secondary">{t.subtitle}</p>

      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={onCreateNew}
          className="flex items-center gap-2 rounded-xl bg-sapphire px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:bg-sapphire-hover"
        >
          <Sparkles size={16} />
          {t.createCta}
        </button>
        <button
          type="button"
          onClick={onReimagine}
          className="flex items-center gap-2 rounded-xl border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-surface-secondary"
        >
          <ImageIcon size={16} />
          {t.reimagineCta}
        </button>
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {IDEA_EXAMPLE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onExampleSelected(preset)}
            className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-sapphire"
          >
            {messages.ideaGenerator.examples[preset.id]}
          </button>
        ))}
      </div>
    </div>
  );
}
