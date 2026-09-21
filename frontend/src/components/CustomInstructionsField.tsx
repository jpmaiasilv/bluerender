import { useLanguage } from '../i18n';

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function CustomInstructionsField({ value, onChange, disabled }: Props) {
  const { messages } = useLanguage();

  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">
        {messages.fields.customInstructions}{' '}
        <span className="normal-case text-ink-muted">({messages.fields.customInstructionsOptional})</span>
      </span>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={messages.fields.customInstructionsPlaceholder}
        className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-muted focus:border-sapphire focus:ring-1 focus:ring-sapphire disabled:cursor-not-allowed disabled:opacity-50"
      />
    </label>
  );
}
