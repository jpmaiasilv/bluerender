import { IDEA_TRANSFORMATION_VALUES } from '../../lib/options';
import { TransformationLevel } from '../../types';
import { useLanguage } from '../../i18n';

interface Props {
  value: TransformationLevel;
  onChange: (value: TransformationLevel) => void;
  disabled?: boolean;
}

/** Only rendered when a reference image is attached (section 28). Distinct from ArchitecturePreservation: preservation = geometry, transformation = visual freedom. */
export function TransformationLevelControl({ value, onChange, disabled }: Props) {
  const { messages } = useLanguage();
  const t = messages.ideaGenerator;

  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.transformationLabel}</span>
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface-secondary p-1">
        {IDEA_TRANSFORMATION_VALUES.map((level) => (
          <button
            key={level}
            type="button"
            disabled={disabled}
            onClick={() => onChange(level)}
            className={`rounded-md py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
              value === level ? 'bg-surface text-sapphire shadow-card' : 'text-ink-secondary hover:text-ink'
            }`}
          >
            {t.transformationLevels[level]}
          </button>
        ))}
      </div>
    </div>
  );
}
