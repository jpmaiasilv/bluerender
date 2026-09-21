import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ToolLayout } from '../components/ToolLayout';
import { VideoComposer } from '../components/video-generator/VideoComposer';
import { SourceImageUpload } from '../components/video-generator/SourceImageUpload';
import { VideoDurationSelector } from '../components/video-generator/VideoDurationSelector';
import { VideoCreditGenerationButton } from '../components/video-generator/VideoCreditGenerationButton';
import { VideoLoadingStatus } from '../components/video-generator/VideoLoadingStatus';
import { VideoEmptyState } from '../components/video-generator/VideoEmptyState';
import { VideoResultPlayer } from '../components/video-generator/VideoResultPlayer';
import { ErrorPanel } from '../components/ErrorPanel';
import { RecentGenerations } from '../components/history/RecentGenerations';
import { ApiError, fetchVideoPricing, pollVideoGeneratorJobUntilDone, submitVideoGeneratorJob } from '../lib/api';
import { loadHistory, saveHistoryEntry } from '../lib/history';
import {
  HistoryEntry,
  isVideoHistoryEntry,
  JobErrorPayload,
  JobStage,
  VideoGeneratorSettings,
  VideoJobResultPayload,
  VideoPricingResponse,
} from '../types';
import { useWalletContext } from '../layouts/RootLayout';
import { useLanguage } from '../i18n';

type Phase = 'idle' | 'generating' | 'complete' | 'error';

const DEFAULT_SETTINGS: VideoGeneratorSettings = {
  prompt: '',
  durationSeconds: 5,
};

export function VideoGeneratorPage() {
  const { messages } = useLanguage();
  const navigate = useNavigate();
  const { walletBalance, walletLoaded, refreshWallet, openUpgradeModal } = useWalletContext();

  const [pricing, setPricing] = useState<VideoPricingResponse | null>(null);
  const [settings, setSettings] = useState<VideoGeneratorSettings>(DEFAULT_SETTINGS);

  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState<JobStage>('uploading');
  const [result, setResult] = useState<VideoJobResultPayload | null>(null);
  const [lastSettings, setLastSettings] = useState<VideoGeneratorSettings | null>(null);
  const [error, setError] = useState<JobErrorPayload | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
    fetchVideoPricing()
      .then(setPricing)
      .catch(() => setPricing(null));
  }, []);

  useEffect(() => {
    return () => {
      if (sourcePreviewUrl) URL.revokeObjectURL(sourcePreviewUrl);
    };
  }, [sourcePreviewUrl]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function handleSourceFileSelected(file: File) {
    if (sourcePreviewUrl) URL.revokeObjectURL(sourcePreviewUrl);
    setSourceFile(file);
    setSourcePreviewUrl(URL.createObjectURL(file));
  }

  function handleClearSourceFile() {
    if (sourcePreviewUrl) URL.revokeObjectURL(sourcePreviewUrl);
    setSourceFile(null);
    setSourcePreviewUrl(null);
  }

  function handleNew() {
    setSettings((prev) => ({ ...prev, prompt: '' }));
    handleClearSourceFile();
    setResult(null);
    setError(null);
    setPhase('idle');
  }

  function handleReuseSettings() {
    if (lastSettings) setSettings(lastSettings);
  }

  async function runGeneration() {
    if (!settings.prompt.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('generating');
    setStage('uploading');
    setError(null);

    try {
      const { jobId } = await submitVideoGeneratorJob(settings, sourceFile);

      const final = await pollVideoGeneratorJobUntilDone(jobId, (status) => setStage(status.stage), controller.signal);

      if (!final.result) throw new ApiError('UNKNOWN_ERROR', 'The generation completed without a result.');

      setResult(final.result);
      setLastSettings(settings);
      setPhase('complete');

      refreshWallet();

      const entry: HistoryEntry = {
        toolId: 'videoIa',
        timestamp: Date.now(),
        engine: `video-${final.result.durationSeconds}s`,
        provider: final.result.provider,
        model: final.result.model,
        creditsCharged: final.result.creditsCharged,
        prompt: final.result.prompt,
        settings,
        generationTimeMs: final.result.generationTimeMs,
        requestId: final.result.requestId,
        imageUrl: final.result.videoUrl,
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
  const totalCost = pricing ? pricing.creditsByDuration[settings.durationSeconds] : 0;
  const canAfford = !pricing || walletBalance >= totalCost;
  const canGenerate = Boolean(settings.prompt.trim()) && Boolean(pricing) && !isGenerating && canAfford;

  return (
    <ToolLayout
      title={messages.nav.items.videoIa}
      description={messages.toolDescriptions.videoIa}
      actions={
        <>
          <button
            type="button"
            onClick={() => navigate('/historico?tool=videoIa')}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
          >
            {messages.videoGenerator.toolbar.history}
          </button>
          {(result || settings.prompt) && (
            <button
              type="button"
              onClick={handleNew}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
            >
              {messages.videoGenerator.toolbar.new}
            </button>
          )}
        </>
      }
    >
      {/* Same workspace(left) + settings-panel(right) architecture as Imagem por Texto / Gerador de Ideias. */}
      <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-6 lg:w-[72%]">
          <VideoComposer
            prompt={settings.prompt}
            onPromptChange={(prompt) => setSettings((prev) => ({ ...prev, prompt }))}
            disabled={isGenerating}
          />

          {phase === 'generating' && <VideoLoadingStatus stage={stage} />}

          {phase === 'error' && error && <ErrorPanel error={error} onRetry={runGeneration} />}

          {phase === 'complete' && result && (
            <VideoResultPlayer result={result} onReuseSettings={handleReuseSettings} onGenerateAgain={runGeneration} />
          )}

          {phase === 'idle' && <VideoEmptyState />}

          <RecentGenerations title={messages.history.recentTests} entries={history.filter(isVideoHistoryEntry)} />
        </div>

        <div className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-t border-border bg-surface px-5 py-6 lg:w-[28%] lg:border-l lg:border-t-0">
          <SourceImageUpload
            previewUrl={sourcePreviewUrl}
            onFileSelected={handleSourceFileSelected}
            onClear={handleClearSourceFile}
            disabled={isGenerating}
            compact
          />

          <VideoDurationSelector
            value={settings.durationSeconds}
            onChange={(durationSeconds) => setSettings((prev) => ({ ...prev, durationSeconds }))}
            disabled={isGenerating}
          />

          <div className="mt-2 border-t border-border pt-4">
            <VideoCreditGenerationButton
              totalCost={totalCost}
              walletBalance={walletBalance}
              walletLoaded={walletLoaded && pricing !== null}
              canAfford={canAfford}
              isGenerating={isGenerating}
              canGenerate={canGenerate}
              onGenerate={runGeneration}
              onOpenUpgrade={openUpgradeModal}
            />
          </div>
        </div>
      </div>
    </ToolLayout>
  );
}
