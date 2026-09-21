import { PreserveLevel } from '../types';
import { PRESERVE_LEVEL_VALUES } from '../lib/options';
import { useLanguage } from '../i18n';

interface Props {
  value: PreserveLevel;
  onChange: (value: PreserveLevel) => void;
}

export function PreserveArchitectureControl({ value, onChange }: Props) {
  const { messages } = useLanguage();

  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">
        {messages.fields.preserveArchitecture}
      </span>
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface-secondary p-1">
        {PRESERVE_LEVEL_VALUES.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => onChange(level)}
            className={`rounded-md py-2 text-sm font-medium transition ${
              value === level ? 'bg-surface text-sapphire shadow-card' : 'text-ink-secondary hover:text-ink'
            }`}
          >
            {messages.fields.preserveLevels[level]}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-ink-muted">{messages.fields.preserveArchitectureHint}</p>
    </div>
  );
}
