import { Type } from 'lucide-react';
import { useLanguage } from '../../i18n';

interface Props {
  onExampleSelected: (example: string) => void;
}

export function GenerationEmptyState({ onExampleSelected }: Props) {
  const { messages } = useLanguage();
  const t = messages.textToImage.emptyState;

  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-secondary px-8 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sapphire-light">
        <Type size={22} className="text-sapphire" />
      </div>
      <p className="text-base font-medium text-ink">{t.title}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-secondary">{t.subtitle}</p>

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {t.examples.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onExampleSelected(example)}
            className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-sapphire"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}
