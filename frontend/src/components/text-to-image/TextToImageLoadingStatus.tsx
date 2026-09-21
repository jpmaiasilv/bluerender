import { JobStage } from '../../types';
import { JOB_STAGE_ORDER } from '../../lib/options';
import { useLanguage } from '../../i18n';

interface Props {
  stage: JobStage;
}

const STAGE_TO_STEP_KEY: Record<JobStage, keyof ReturnType<typeof useLanguage>['messages']['textToImage']['loadingStatus']['steps']> = {
  uploading: 'preparing',
  sending: 'analyzing',
  rendering: 'creating',
  downloading: 'finalizing',
  complete: 'finalizing',
  error: 'finalizing',
};

/**
 * Imagem por Texto's own progressive loading state — same visual language as
 * Render IA's GeneratingStatus, but with copy that matches what's actually
 * happening here (no source image, so no "analyzing your photo" wording) and
 * no fabricated percentages, since the backend doesn't report granular progress.
 */
export function TextToImageLoadingStatus({ stage }: Props) {
  const { messages } = useLanguage();
  const t = messages.textToImage.loadingStatus;
  const currentIndex = JOB_STAGE_ORDER.indexOf(stage);

  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-border bg-surface px-8 text-center shadow-card">
      <div className="mb-5 h-10 w-10 animate-spin rounded-full border-2 border-border border-t-sapphire" />
      <p className="text-base font-medium text-ink">{t.title}</p>

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
              <span className={isDone || isActive ? 'text-ink' : 'text-ink-muted'}>{t.steps[STAGE_TO_STEP_KEY[step]]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
