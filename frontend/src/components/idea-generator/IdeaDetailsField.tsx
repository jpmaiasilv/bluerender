import { useLanguage } from '../../i18n';

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** Optional by design (section 22-23) — a good idea must still be generated when this is left empty. */
export function IdeaDetailsField({ value, onChange, disabled }: Props) {
  const { messages } = useLanguage();
  const t = messages.ideaGenerator;

  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.detailsLabel}</span>
      <p className="mb-1.5 text-xs text-ink-muted">{t.detailsHint}</p>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={t.detailsPlaceholder}
        className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-muted focus:border-sapphire focus:ring-1 focus:ring-sapphire disabled:cursor-not-allowed disabled:opacity-50"
      />
    </label>
  );
}
