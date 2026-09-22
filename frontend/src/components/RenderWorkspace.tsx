import { JobErrorPayload, JobResultPayload, JobStage } from '../types';
import { GeneratingStatus } from './GeneratingStatus';
import { ErrorPanel } from './ErrorPanel';
import { CompareSlider } from './CompareSlider';
import { ResultActions } from './ResultActions';
import { DevInfoPanel } from './DevInfoPanel';
import { UploadDropzone } from './UploadDropzone';
import { useLanguage } from '../i18n';

export type WorkspacePhase = 'idle' | 'generating' | 'complete' | 'error';

interface Props {
  phase: WorkspacePhase;
  stage: JobStage;
  elapsedMs: number;
  previewUrl: string | null;
  onFileSelected: (file: File) => void;
  onClearFile: () => void;
  result: JobResultPayload | null;
  error: JobErrorPayload | null;
  onRetry: () => void;
  onGenerateAgain: () => void;
  onNewImage: () => void;
}

/**
 * The large, protagonist workspace area (~70-75% of the page): upload prompt
 * before a file is chosen, preview once chosen, progress while generating, and
 * the before/after comparison once complete. Composes the same result/error/
 * generating components used before this layout change — no generation logic
 * lives here, it's purely presentational.
 */
export function RenderWorkspace({
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
}: Props) {
  const { messages } = useLanguage();

  if (phase === 'generating') {
    return (
      <div className="flex flex-1 flex-col p-6">
        <GeneratingStatus stage={stage} elapsedMs={elapsedMs} />
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
    // No flex-1/overflow-y-auto here on purpose: RenderPage's own column (the
    // parent) already scrolls the whole thing (this + RecentTests below). A
    // second flex-1+overflow-y-auto nested inside it made this box's
    // automatic min-height resolve to 0, so it got crushed by its
    // RecentTests sibling instead of showing its full content.
    return (
      <div className="flex flex-col gap-4 p-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-ink-secondary">{messages.result.compare}</h2>
        <CompareSlider beforeSrc={previewUrl} afterSrc={result.imageUrl} />
        <ResultActions imageUrl={result.imageUrl} onGenerateAgain={onGenerateAgain} onNewImage={onNewImage} />
        {result.resolution && (
          <p className="text-center text-xs text-ink-muted">
            {messages.result.resolution}: {result.resolution.width} × {result.resolution.height}
          </p>
        )}
        <DevInfoPanel result={result} />
      </div>
    );
  }

  // idle — no file yet, or a file was chosen but generation hasn't started.
  return (
    <div className="flex flex-1 flex-col p-6">
      <UploadDropzone
        label={messages.upload.architecturalModel}
        dragDropText={messages.upload.dragDrop}
        previewUrl={previewUrl}
        onFileSelected={onFileSelected}
        onClear={onClearFile}
        hideLabel
      />
    </div>
  );
}
