import { IDEA_PRESERVATION_VALUES } from '../../lib/options';
import { PreservationLevel } from '../../types';
import { useLanguage } from '../../i18n';

interface Props {
  value: PreservationLevel;
  onChange: (value: PreservationLevel) => void;
  disabled?: boolean;
}

/** Only rendered when a reference image is attached (section 27). */
export function ArchitecturePreservation({ value, onChange, disabled }: Props) {
  const { messages } = useLanguage();
  const t = messages.ideaGenerator;

  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.preservationLabel}</span>
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface-secondary p-1">
        {IDEA_PRESERVATION_VALUES.map((level) => (
          <button
            key={level}
            type="button"
            disabled={disabled}
            onClick={() => onChange(level)}
            className={`rounded-md py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
              value === level ? 'bg-surface text-sapphire shadow-card' : 'text-ink-secondary hover:text-ink'
            }`}
          >
            {t.preservationLevels[level]}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-ink-muted">{t.preservationHint}</p>
    </div>
  );
}
