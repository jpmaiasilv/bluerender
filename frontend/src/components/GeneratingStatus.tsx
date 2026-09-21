import { JobStage } from '../types';
import { JOB_STAGE_ORDER } from '../lib/options';
import { useLanguage } from '../i18n';

interface Props {
  stage: JobStage;
  elapsedMs: number;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const STAGE_TO_STEP_KEY: Record<JobStage, keyof import('../i18n').Messages['generatingStatus']['steps']> = {
  uploading: 'preparing',
  sending: 'analyzing',
  rendering: 'creating',
  downloading: 'finalizing',
  complete: 'finalizing',
  error: 'finalizing',
};

export function GeneratingStatus({ stage, elapsedMs }: Props) {
  const { messages } = useLanguage();
  const currentIndex = JOB_STAGE_ORDER.indexOf(stage);

  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-border bg-surface px-8 text-center shadow-card">
      <div className="mb-5 h-10 w-10 animate-spin rounded-full border-2 border-border border-t-sapphire" />
      <p className="text-base font-medium text-ink">{messages.generatingStatus.title}</p>
      <p className="mt-1 text-sm text-ink-muted">
        {messages.generatingStatus.elapsed}: {formatElapsed(elapsedMs)}
      </p>

      <div className="mt-6 flex flex-col gap-2 text-left">
        {JOB_STAGE_ORDER.map((step, i) => {
          const isDone = currentIndex > i || stage === 'complete';
          const isActive = JOB_STAGE_ORDER[currentIndex] === step;
          return (
            <div key={step} className="flex items-center gap-2 text-sm">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isDone ? 'bg-sapphire' : isActive ? 'bg-sapphire animate-pulse' : 'bg-border'
                }`}
              />
              <span className={isDone || isActive ? 'text-ink' : 'text-ink-muted'}>
                {messages.generatingStatus.steps[STAGE_TO_STEP_KEY[step]]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
