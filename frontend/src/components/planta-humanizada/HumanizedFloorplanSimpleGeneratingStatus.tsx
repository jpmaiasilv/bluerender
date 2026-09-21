import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { HumanizedFloorplanGenerationMode, HumanizedFloorplanSimpleJobStage } from '../../types';
import { useLanguage } from '../../i18n';

interface Props {
  elapsedMs: number;
  /** The backend's real stage — the highlighted step is whatever the server reports, never a timer. */
  stage: HumanizedFloorplanSimpleJobStage;
  mode: HumanizedFloorplanGenerationMode;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const STANDARD_STEPS = ['uploading', 'analyzing', 'generating', 'finalizing'] as const;
const ASTRA_STEPS = ['analyzing_architecture', 'preparing', 'generating', 'finalizing'] as const;

export function HumanizedFloorplanSimpleGeneratingStatus({ elapsedMs, stage, mode }: Props) {
  const { messages } = useLanguage();
  const t = messages.plantaHumanizada.simpleFlow;
  const [maxReached, setMaxReached] = useState(0);

  const steps: ReadonlyArray<string> = mode === 'astra' ? ASTRA_STEPS : STANDARD_STEPS;
  const label = (step: string): string => (mode === 'astra' ? t.astraStages[step as keyof typeof t.astraStages] : t.stages[step as keyof typeof t.stages]);
  const rawIndex = steps.indexOf(stage);
  const activeIndex = rawIndex >= 0 ? rawIndex : 0;

  // Furthest step the backend has actually reached: steps before it are shown as done, never as pending.
  useEffect(() => {
    setMaxReached((m) => Math.max(m, activeIndex));
  }, [activeIndex]);

  return (
    <div className="flex flex-col items-center rounded-2xl border border-border bg-surface px-6 py-10 text-center shadow-card sm:px-8 lg:sticky lg:top-6">
      <p className="text-base font-medium text-ink">{t.processingTitle}</p>
      <p className="mt-1 text-sm text-ink-muted">
        {t.processingElapsed}: {formatElapsed(elapsedMs)}
      </p>
      <ol className="mt-6 flex flex-col gap-3 text-left">
        {steps.map((step, i) => {
          const active = i === activeIndex;
          const done = !active && i <= Math.max(maxReached, activeIndex);
          return (
            <li key={step} className={`flex items-center gap-2.5 text-sm ${active ? 'font-medium text-ink' : done ? 'text-ink-secondary' : 'text-ink-muted'}`}>
              {done ? <CheckCircle2 size={18} className="text-sapphire" /> : active ? <Loader2 size={18} className="animate-spin text-sapphire" /> : <Circle size={18} />}
              {label(step)}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
