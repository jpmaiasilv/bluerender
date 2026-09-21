import { useRef, useState } from 'react';
import { Download, Film } from 'lucide-react';
import { Modal } from '../Modal';
import { useLanguage } from '../../i18n';
import { ApiError, pollEditorExportJobUntilDone, submitEditorExportJob } from '../../lib/api';
import { EditorExportResult, JobErrorPayload } from '../../types';
import { EditorProject, toExportProject } from './editorState';

type Phase = 'idle' | 'preparing' | 'exporting' | 'ready' | 'error';

interface Props {
  project: EditorProject;
  disabled: boolean;
}

export function ExportPanel({ project, disabled }: Props) {
  const { messages } = useLanguage();
  const t = messages.videoEditor.export;
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<EditorExportResult | null>(null);
  const [error, setError] = useState<JobErrorPayload | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function runExport() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('preparing');
    setProgress(0);
    setError(null);
    setResult(null);

    try {
      const { jobId } = await submitEditorExportJob(toExportProject(project));
      setPhase('exporting');

      const final = await pollEditorExportJobUntilDone(
        jobId,
        (status) => {
          setProgress(status.progress ?? 0);
          if (status.stage === 'rendering' || status.stage === 'downloading') setPhase('exporting');
        },
        controller.signal
      );

      if (!final.result) throw new ApiError('EXPORT_FAILED', 'Export finished without a result.');
      setResult(final.result);
      setPhase('ready');
    } catch (err) {
      const apiError =
        err instanceof ApiError
          ? { code: err.code, message: err.message, details: err.details }
          : { code: 'EXPORT_FAILED' as const, message: t.failed, details: String(err) };
      setError(apiError);
      setPhase('error');
    }
  }

  const modalOpen = phase !== 'idle';

  return (
    <>
      <button
        type="button"
        onClick={runExport}
        disabled={disabled}
        className="flex items-center gap-1.5 rounded-lg bg-sapphire px-4 py-2 text-sm font-medium text-white transition hover:bg-sapphire-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Film size={14} />
        {t.button}
      </button>

      <Modal open={modalOpen} onClose={() => phase !== 'exporting' && phase !== 'preparing' && setPhase('idle')} panelClassName="w-full max-w-[420px]">
        <div className="flex flex-col items-center gap-4 px-8 py-10 text-center">
          {(phase === 'preparing' || phase === 'exporting') && (
            <>
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-sapphire border-t-transparent" />
              <p className="text-sm font-medium text-ink">{phase === 'preparing' ? t.preparing : t.exporting(progress)}</p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-secondary">
                <div className="h-full bg-sapphire transition-all" style={{ width: `${phase === 'preparing' ? 5 : Math.max(5, progress)}%` }} />
              </div>
            </>
          )}

          {phase === 'ready' && result && (
            <>
              <p className="text-sm font-semibold text-ink">{t.ready}</p>
              <video src={result.videoUrl} controls className="max-h-[40vh] w-full rounded-lg" />
              <div className="flex w-full gap-2">
                <a
                  href={result.videoUrl}
                  download
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-sapphire px-3 py-2 text-sm font-medium text-white transition hover:bg-sapphire-hover"
                >
                  <Download size={14} />
                  {t.download}
                </a>
                <button
                  type="button"
                  onClick={() => setPhase('idle')}
                  className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-sapphire"
                >
                  {t.continueEditing}
                </button>
              </div>
            </>
          )}

          {phase === 'error' && (
            <>
              <p className="text-sm font-semibold text-danger">{error?.message ?? t.failed}</p>
              <button
                type="button"
                onClick={() => setPhase('idle')}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-sapphire"
              >
                {t.continueEditing}
              </button>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
