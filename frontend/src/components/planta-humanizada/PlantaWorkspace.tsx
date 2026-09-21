import { HumanizedFloorplanJobStage, JobErrorPayload, PlantaJobResultPayload } from '../../types';
import { HumanizedFloorplanGeneratingStatus } from './HumanizedFloorplanGeneratingStatus';
import { ErrorPanel } from '../ErrorPanel';
import { CompareSlider } from '../CompareSlider';
import { UploadDropzone } from '../UploadDropzone';
import { PlantaDevInfoPanel } from './PlantaDevInfoPanel';
import { PlantaResultActions } from './PlantaResultActions';
import { useLanguage } from '../../i18n';

export type PlantaWorkspacePhase = 'idle' | 'generating' | 'complete' | 'error';

interface Props {
  phase: PlantaWorkspacePhase;
  stage: HumanizedFloorplanJobStage;
  elapsedMs: number;
  previewUrl: string | null;
  onFileSelected: (file: File) => void;
  onClearFile: () => void;
  result: PlantaJobResultPayload | null;
  error: JobErrorPayload | null;
  onRetry: () => void;
  onGenerateAgain: () => void;
  onNewImage: () => void;
  onCleanup: () => void;
  isCleaning: boolean;
}

/** Mirrors RenderWorkspace.tsx exactly, typed for Planta Humanizada's own job/result shape — same upload/progress/compare/error states, same components. */
export function PlantaWorkspace({
  phase,
  stage,
  elapsedMs,
  previewUrl,
  onFileSelected,
  onClearFile,
  result,
  error,
  onRetry,
  onGenerateAgain,
  onNewImage,
  onCleanup,
  isCleaning,
}: Props) {
  const { messages } = useLanguage();
  const t = messages.plantaHumanizada;

  if (phase === 'generating') {
    return (
      <div className="flex flex-1 flex-col p-6">
        <HumanizedFloorplanGeneratingStatus stage={stage} elapsedMs={elapsedMs} />
      </div>
    );
  }

  if (phase === 'error' && error) {
    return (
      <div className="flex flex-1 flex-col p-6">
        <ErrorPanel error={error} onRetry={onRetry} />
      </div>
    );
  }

  if (phase === 'complete' && result && previewUrl) {
    return (
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-ink-secondary">{messages.result.compare}</h2>
        <CompareSlider beforeSrc={previewUrl} afterSrc={result.imageUrl} />
        <PlantaResultActions
          imageUrl={result.imageUrl}
          onGenerateAgain={onGenerateAgain}
          onNewImage={onNewImage}
          onCleanup={onCleanup}
          isCleaning={isCleaning}
        />
        {result.resolution && (
          <p className="text-center text-xs text-ink-muted">
            {messages.result.resolution}: {result.resolution.width} × {result.resolution.height}
          </p>
        )}
        <PlantaDevInfoPanel result={result} />
      </div>
    );
  }

  // idle — no file yet, or a file was chosen but generation hasn't started.
  return (
    <div className="flex flex-1 flex-col p-6">
      <UploadDropzone
        label={t.uploadLabel}
        dragDropText={t.uploadDragDrop}
        previewUrl={previewUrl}
        onFileSelected={onFileSelected}
        onClear={onClearFile}
        hideLabel
      />
    </div>
  );
}
