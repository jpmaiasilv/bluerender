import { HumanizedFloorplanJobStage } from '../../types';
import { useLanguage } from '../../i18n';

interface Props {
  stage: HumanizedFloorplanJobStage;
  elapsedMs: number;
}

/**
 * Planta Humanizada's OWN generating-status indicator — deliberately NOT
 * the shared components/GeneratingStatus.tsx (which every other tool's
 * route still uses with the shared `JobStage`). This pipeline has five
 * meaningfully different phases (requirement: "analisando arquitetura;
 * reconhecendo móveis; refinando objetos; humanizando planta; validando
 * resultado") that don't map onto the generic upload/send/render/download
 * steps, so it gets its own step list instead of overloading the shared one.
 */
const STAGE_ORDER: HumanizedFloorplanJobStage[] = [
  'analyzing_structure',
  'recognizing_furniture',
  'refining_objects',
  'humanizing',
  'validating',
];

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function HumanizedFloorplanGeneratingStatus({ stage, elapsedMs }: Props) {
  const { messages } = useLanguage();
  const t = messages.plantaHumanizada.generatingStatus;

  // 'uploading' hasn't reached the first real stage yet; 'complete'/'error' are shown by the caller's own phase switch, but if seen here, treat every step as done.
  const currentIndex = stage === 'uploading' ? -1 : STAGE_ORDER.indexOf(stage);

  const stepLabel: Record<HumanizedFloorplanJobStage, string> = {
    uploading: t.steps.analyzingStructure,
    analyzing_structure: t.steps.analyzingStructure,
    recognizing_furniture: t.steps.recognizingFurniture,
    refining_objects: t.steps.refiningObjects,
    humanizing: t.steps.humanizing,
    validating: t.steps.validating,
    complete: t.steps.validating,
    error: t.steps.validating,
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-border bg-surface px-8 text-center shadow-card">
      <div className="mb-5 h-10 w-10 animate-spin rounded-full border-2 border-border border-t-sapphire" />
      <p className="text-base font-medium text-ink">{t.title}</p>
      <p className="mt-1 text-sm text-ink-muted">
        {t.elapsed}: {formatElapsed(elapsedMs)}
      </p>

      <div className="mt-6 flex flex-col gap-2 text-left">
        {STAGE_ORDER.map((step, i) => {
          const isDone = currentIndex > i || stage === 'complete';
          const isActive = STAGE_ORDER[currentIndex] === step;
          return (
            <div key={step} className="flex items-center gap-2 text-sm">
              <span className={`h-1.5 w-1.5 rounded-full ${isDone ? 'bg-sapphire' : isActive ? 'bg-sapphire animate-pulse' : 'bg-border'}`} />
              <span className={isDone || isActive ? 'text-ink' : 'text-ink-muted'}>{stepLabel[step]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
