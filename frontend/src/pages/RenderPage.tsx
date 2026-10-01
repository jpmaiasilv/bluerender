import { useEffect, useRef, useState } from 'react';
import { RenderWorkspace, WorkspacePhase } from '../components/RenderWorkspace';
import { RenderSettingsPanel } from '../components/RenderSettingsPanel';
import { FreeformRenderPanel } from '../components/FreeformRenderPanel';
import { RecentTests } from '../components/RecentTests';
import { ApiError, fetchEngines, pollJobUntilDone, submitGenerationJob } from '../lib/api';
import { loadHistory, saveHistoryEntry } from '../lib/history';
import { EngineInfo, FreeformRenderSettings, GuidedRenderSettings, HistoryEntry, JobErrorPayload, JobResultPayload, JobStage, RenderMode, RenderSettings } from '../types';
import { useWalletContext } from '../layouts/RootLayout';
import { useLanguage } from '../i18n';

const DEFAULT_GUIDED_SETTINGS: GuidedRenderSettings = {
  mode: 'guided',
  projectType: 'exterior',
  preserveArchitecture: 'high',
  renderStyle: 'photorealistic',
  lighting: 'daylight',
  environment: 'preserve_original',
  led: 'automatic',
  aspectRatio: 'automatic',
  customInstructions: '',
  engine: 'fast',
};

const DEFAULT_FREEFORM_SETTINGS: FreeformRenderSettings = {
  mode: 'freeform',
  prompt: '',
  aspectRatio: 'automatic',
  engine: 'fast',
};

/**
 * Render IA, migrated into the new platform shell. All generation logic below is
 * unchanged from before the redesign — same job submission, polling, credit
 * debiting on the backend, and error handling. Only the visual layout changed.
 */
export function RenderPage() {
  const { messages } = useLanguage();
  const { walletBalance, refreshWallet } = useWalletContext();

  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [settings, setSettings] = useState<RenderSettings>(DEFAULT_GUIDED_SETTINGS);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referencePreviewUrl, setReferencePreviewUrl] = useState<string | null>(null);

  const [phase, setPhase] = useState<WorkspacePhase>('idle');
  const [stage, setStage] = useState<JobStage>('uploading');
  const [jobStartedAt, setJobStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<JobResultPayload | null>(null);
  const [error, setError] = useState<JobErrorPayload | null>(null);

  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
    fetchEngines()
      .then((list) => {
        setEngines(list);
        // The featured (non-legacy) engines always come first — see config/renderEngines.ts.
        if (list.length > 0) setSettings((prev) => ({ ...prev, engine: list[0].id }));
      })
      .catch(() => setEngines([]));
  }, []);

  useEffect(() => {
    if (phase !== 'generating' || jobStartedAt === null) return;
    const interval = setInterval(() => setElapsedMs(Date.now() - jobStartedAt), 250);
    return () => clearInterval(interval);
  }, [phase, jobStartedAt]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
    };
  }, [referencePreviewUrl]);

  function handleFileSelected(nextFile: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(nextFile);
    setPreviewUrl(URL.createObjectURL(nextFile));
    setPhase('idle');
    setResult(null);
    setError(null);
  }

  function handleClearFile() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
    setReferenceFile(null);
    setReferencePreviewUrl(null);
    setPhase('idle');
    setResult(null);
    setError(null);
  }

  function handleReferenceFileSelected(nextFile: File) {
    if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
    setReferenceFile(nextFile);
    setReferencePreviewUrl(URL.createObjectURL(nextFile));
  }

  function handleClearReferenceFile() {
    if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
    setReferenceFile(null);
    setReferencePreviewUrl(null);
  }

  // Switching modes keeps the engine (common to both), but otherwise starts
  // that mode's own defaults — the two settings shapes don't share fields to carry over.
  function handleModeChange(mode: RenderMode) {
    setSettings((prev) =>
      mode === 'freeform' ? { ...DEFAULT_FREEFORM_SETTINGS, engine: prev.engine } : { ...DEFAULT_GUIDED_SETTINGS, engine: prev.engine }
    );
  }

  async function runGeneration() {
    if (!file) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('generating');
    setStage('uploading');
    setError(null);

    try {
      const { jobId, startedAt } = await submitGenerationJob(file, settings, referenceFile);
      setJobStartedAt(startedAt);
      setElapsedMs(0);

      const final = await pollJobUntilDone(
        jobId,
        (status) => {
          setStage(status.stage);
        },
        controller.signal
      );

      if (!final.result) throw new ApiError('UNKNOWN_ERROR', 'The generation completed without a result.');

      setResult(final.result);
      setPhase('complete');

      // The backend is the source of truth for whether/how much was charged —
      // just refetch the real balance rather than guessing the new value locally.
      refreshWallet();

      const entry: HistoryEntry = {
        toolId: 'render',
        timestamp: Date.now(),
        engine: final.result.engine,
        provider: final.result.provider,
        model: final.result.model,
        creditsCharged: final.result.creditsCharged,
        prompt: final.result.prompt,
        settings,
        generationTimeMs: final.result.generationTimeMs,
        requestId: final.result.requestId,
        imageUrl: final.result.imageUrl,
      };
      setHistory(saveHistoryEntry(entry));
    } catch (err) {
      const apiError =
        err instanceof ApiError
          ? { code: err.code, message: err.message, details: err.details }
          : { code: 'UNKNOWN_ERROR' as const, message: 'An unexpected error occurred.', details: String(err) };
      setError(apiError);
      setPhase('error');
    }
  }

  const isGenerating = phase === 'generating';
  const canGenerate =
    Boolean(file) &&
    Boolean(settings.engine) &&
    !isGenerating &&
    (settings.mode !== 'freeform' || Boolean(settings.prompt.trim()));

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-y-auto">
          <RenderWorkspace
            phase={phase}
            stage={stage}
            elapsedMs={elapsedMs}
            previewUrl={previewUrl}
            onFileSelected={handleFileSelected}
            onClearFile={handleClearFile}
            result={result}
            error={error}
            onRetry={runGeneration}
            onGenerateAgain={runGeneration}
            onNewImage={handleClearFile}
          />
          <div className="px-6 pb-6">
            <RecentTests entries={history} />
          </div>
        </div>

        <div className="flex w-[340px] shrink-0 flex-col border-l border-border bg-surface">
          <div className="flex gap-1 border-b border-border p-2">
            {(['guided', 'freeform'] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={isGenerating}
                onClick={() => handleModeChange(m)}
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  (settings.mode ?? 'guided') === m ? 'bg-sapphire-light text-sapphire' : 'text-ink-secondary hover:bg-surface-secondary'
                }`}
              >
                {m === 'guided' ? messages.renderModeToggle.guided : messages.renderModeToggle.freeform}
              </button>
            ))}
          </div>

          {settings.mode === 'freeform' ? (
            <FreeformRenderPanel
              settings={settings}
              onSettingsChange={setSettings}
              engines={engines}
              walletBalance={walletBalance}
              disabled={isGenerating}
              onGenerate={runGeneration}
              canGenerate={canGenerate}
              isGenerating={isGenerating}
            />
          ) : (
            <RenderSettingsPanel
              settings={settings}
              onSettingsChange={setSettings}
              referencePreviewUrl={referencePreviewUrl}
              onReferenceFileSelected={handleReferenceFileSelected}
              onClearReferenceFile={handleClearReferenceFile}
              engines={engines}
              walletBalance={walletBalance}
              disabled={isGenerating}
              onGenerate={runGeneration}
              canGenerate={canGenerate}
              isGenerating={isGenerating}
            />
          )}
        </div>
      </div>
    </div>
  );
}
