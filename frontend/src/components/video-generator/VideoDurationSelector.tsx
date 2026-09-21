import { VIDEO_DURATION_VALUES } from '../../lib/options';
import { VideoDuration } from '../../types';
import { useLanguage } from '../../i18n';

interface Props {
  value: VideoDuration;
  onChange: (value: VideoDuration) => void;
  disabled?: boolean;
}

export function VideoDurationSelector({ value, onChange, disabled }: Props) {
  const { messages } = useLanguage();
  const t = messages.videoGenerator;

  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.durationLabel}</span>
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface-secondary p-1">
        {VIDEO_DURATION_VALUES.map((seconds) => (
          <button
            key={seconds}
            type="button"
            disabled={disabled}
            onClick={() => onChange(seconds)}
            className={`rounded-md py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
              value === seconds ? 'bg-surface text-sapphire shadow-card' : 'text-ink-secondary hover:text-ink'
            }`}
          >
            {t.durationOptionLabel(seconds)}
          </button>
        ))}
      </div>
    </div>
  );
}
