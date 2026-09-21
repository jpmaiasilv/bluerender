import { Wand2 } from 'lucide-react';
import { useLanguage } from '../../i18n';

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * The "Gerar prompt automático" button is intentionally disabled — it needs
 * an image-understanding (vision) model to analyze the uploaded floor plan
 * and describe it, which this backend doesn't have yet (only image
 * generation providers — BFL, xAI — are wired up so far). The field itself
 * is fully usable for manual descriptions in the meantime; the button is a
 * clearly-labeled placeholder for that follow-up, not a broken control.
 */
export function PlantaPromptField({ value, onChange, disabled }: Props) {
  const { messages } = useLanguage();
  const t = messages.plantaHumanizada;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.promptLabel}</span>
        <button
          type="button"
          disabled
          title={t.autoPromptComingSoon}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1 text-[11px] font-medium text-ink-muted opacity-70"
        >
          <Wand2 size={12} />
          {t.autoPromptButton}
        </button>
      </div>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder={t.promptPlaceholder}
        className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-muted focus:border-sapphire focus:ring-1 focus:ring-sapphire disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}
