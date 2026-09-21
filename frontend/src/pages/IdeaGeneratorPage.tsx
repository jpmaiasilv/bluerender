import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ToolLayout } from '../components/ToolLayout';
import { EnvironmentSelector } from '../components/idea-generator/EnvironmentSelector';
import { SpaceSelector } from '../components/idea-generator/SpaceSelector';
import { IdeaGoalSelector } from '../components/idea-generator/IdeaGoalSelector';
import { IdeaStyleSelector } from '../components/idea-generator/IdeaStyleSelector';
import { IdeaDetailsField } from '../components/idea-generator/IdeaDetailsField';
import { ReferenceImageUpload } from '../components/idea-generator/ReferenceImageUpload';
import { IdeaEngineTierSelector } from '../components/idea-generator/IdeaEngineTierSelector';
import { ArchitecturePreservation } from '../components/idea-generator/ArchitecturePreservation';
import { TransformationLevelControl } from '../components/idea-generator/TransformationLevelControl';
import { IdeaAdvancedOptions } from '../components/idea-generator/IdeaAdvancedOptions';
import { IdeaCreditGenerationButton } from '../components/idea-generator/IdeaCreditGenerationButton';
import { IdeaLoadingStatus } from '../components/idea-generator/IdeaLoadingStatus';
import { IdeaEmptyState } from '../components/idea-generator/IdeaEmptyState';
import { IdeaResultGallery } from '../components/idea-generator/IdeaResultGallery';
import { ErrorPanel } from '../components/ErrorPanel';
import { RecentGenerations } from '../components/history/RecentGenerations';
import { ApiError, fetchIdeaGeneratorEngines, pollIdeaGeneratorJobUntilDone, submitIdeaGeneratorJob } from '../lib/api';
import { loadHistory, saveHistoryEntry } from '../lib/history';
import { IDEA_GOALS_BY_ENVIRONMENT } from '../lib/options';
import { IdeaExamplePreset } from '../lib/ideaExamples';
import {
  HistoryEntry,
  IdeaEngineInfo,
  IdeaGenerationMode,
  IdeaGeneratedImage,
  IdeaGeneratorSettings,
  isIdeaGeneratorHistoryEntry,
  JobErrorPayload,
  JobStage,
} from '../types';
import { useWalletContext } from '../layouts/RootLayout';
import { useLanguage } from '../i18n';

type Phase = 'idle' | 'generating' | 'complete' | 'error';

const DEFAULT_SETTINGS: IdeaGeneratorSettings = {
  environment: 'interior',
  space: 'Sala de estar',
  goal: 'nova_decoracao',
  style: 'automatico',
  details: '',
  engine: 'pro',
  count: 1,
  preservation: 'alta',
  transformation: 'equilibrada',
  lighting: 'automatica',
  camera: 'automatica',
  atmosphere: 'neutra',
  materials: 'automatico',
  surroundings: 'preserve_original',
  led: 'automatic',
  creativity: 'equilibrada',
};

export function IdeaGeneratorPage() {
  const { messages } = useLanguage();
  const navigate = useNavigate();
  const { walletBalance, walletLoaded, refreshWallet, openUpgradeModal } = useWalletContext();

  const [engines, setEngines] = useState<IdeaEngineInfo[]>([]);
  const [settings, setSettings] = useState<IdeaGeneratorSettings>(DEFAULT_SETTINGS);

  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referencePreviewUrl, setReferencePreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState<JobStage>('uploading');
  const [result, setResult] = useState<{ mode: IdeaGenerationMode; images: IdeaGeneratedImage[]; requestedCount: number } | null>(
    null
  );
  const [resultReferenceUrl, setResultReferenceUrl] = useState<string | null>(null);
  const [lastSettings, setLastSettings] = useState<IdeaGeneratorSettings | null>(null);
  const [error, setError] = useState<JobErrorPayload | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const hasReferenceImage = Boolean(referenceFile);
  const mode: IdeaGenerationMode = hasReferenceImage ? 'imageToImage' : 'textToImage';

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    fetchIdeaGeneratorEngines(mode)
      .then((list) => {
        setEngines(list);
        // The featured (non-legacy) engines always come first — see config/ideaGeneratorEngines.ts.
        if (list.length > 0) setSettings((prev) => ({ ...prev, engine: list[0].id }));
      })
      .catch(() => setEngines([]));
    // Refetch whenever the mode (text-to-image vs image-to-image) changes — the two can have different costs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    return () => {
      if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
    };
  }, [referencePreviewUrl]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function handleReferenceFileSelected(file: File) {
    if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
    setReferenceFile(file);
    setReferencePreviewUrl(URL.createObjectURL(file));
  }

  function handleClearReferenceFile() {
    if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
    setReferenceFile(null);
    setReferencePreviewUrl(null);
  }

  async function handleUseAsNewBase(image: IdeaGeneratedImage) {
    try {
      const res = await fetch(image.imageUrl);
      const blob = await res.blob();
      const extension = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
      const file = new File([blob], `${image.requestId}.${extension}`, { type: blob.type });
      handleReferenceFileSelected(file);
      setResult(null);
      setError(null);
      setPhase('idle');
    } catch {
      // Non-critical convenience action — silently ignore on failure.
    }
  }

  function handleExampleSelected(preset: IdeaExamplePreset) {
    setSettings((prev) => ({
      ...prev,
      environment: preset.environment,
      style: preset.style,
      goal: IDEA_GOALS_BY_ENVIRONMENT[preset.environment][0],
    }));
  }

  function handleReimagineClick() {
    fileInputRef.current?.click();
  }

  function handleCreateNewClick() {
    settingsPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleNew() {
    handleClearReferenceFile();
    setResult(null);
    setResultReferenceUrl(null);
    setError(null);
    setPhase('idle');
  }

  function handleReuseSettings() {
    if (lastSettings) setSettings(lastSettings);
  }

  async function runGeneration() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('generating');
    setStage('uploading');
    setError(null);

    try {
      const { jobId } = await submitIdeaGeneratorJob(settings, referenceFile);

      const final = await pollIdeaGeneratorJobUntilDone(jobId, (status) => setStage(status.stage), controller.signal);

      if (!final.result) throw new ApiError('UNKNOWN_ERROR', 'The generation completed without a result.');

      setResult({ mode: final.result.mode, images: final.result.images, requestedCount: final.result.requestedCount });
      setResultReferenceUrl(referencePreviewUrl);
      setLastSettings(settings);
      setPhase('complete');

      refreshWallet();

      const firstImage = final.result.images[0];
      const entry: HistoryEntry = {
        toolId: 'ideaGenerator',
        timestamp: Date.now(),
        engine: final.result.engine,
        provider: final.result.provider,
        model: final.result.model,
        creditsCharged: final.result.creditsCharged,
        prompt: final.result.prompt,
        settings,
        generationTimeMs: final.result.generationTimeMs,
        requestId: firstImage?.requestId ?? '',
        imageUrl: firstImage?.imageUrl ?? '',
        images: final.result.images,
        quantity: final.result.requestedCount,
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
  const selectedEngine = engines.find((e) => e.id === settings.engine);
  const totalCost = selectedEngine ? selectedEngine.credits * settings.count : 0;
  const canAfford = !selectedEngine || walletBalance >= totalCost;
  const canGenerate = Boolean(settings.space.trim()) && Boolean(selectedEngine) && !isGenerating && canAfford;

  return (
    <ToolLayout
      title={messages.nav.items.ideaGenerator}
      description={messages.toolDescriptions.ideaGenerator}
      actions={
        <>
          <button
            type="button"
            onClick={() => navigate('/historico?tool=ideaGenerator')}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
          >
            {messages.ideaGenerator.toolbar.history}
          </button>
          {(result || referenceFile) && (
            <button
              type="button"
              onClick={handleNew}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
            >
              {messages.ideaGenerator.toolbar.new}
            </button>
          )}
        </>
      }
    >
      <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-6 lg:w-[72%]">
          {referencePreviewUrl && (
            <div className="relative overflow-hidden rounded-2xl border border-border bg-surface">
              <img src={referencePreviewUrl} alt="" className="max-h-[50vh] w-full object-contain" />
              <div className="absolute right-3 top-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-md bg-ink/70 px-2.5 py-1 text-xs text-white hover:bg-ink/90"
                >
                  {messages.ideaGenerator.reference.change}
                </button>
                <button
                  type="button"
                  onClick={handleClearReferenceFile}
                  className="rounded-md bg-ink/70 px-2.5 py-1 text-xs text-white hover:bg-ink/90"
                >
                  {messages.ideaGenerator.reference.remove}
                </button>
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleReferenceFileSelected(file);
              e.target.value = '';
            }}
          />

          {phase === 'generating' && <IdeaLoadingStatus stage={stage} />}

          {phase === 'error' && error && <ErrorPanel error={error} onRetry={runGeneration} />}

          {phase === 'complete' && result && result.images.length > 0 && (
            <IdeaResultGallery
              images={result.images}
              requestedCount={result.requestedCount}
              originalImageUrl={resultReferenceUrl}
              onReuseSettings={handleReuseSettings}
              onGenerateVariation={() => runGeneration()}
              onUseAsNewBase={handleUseAsNewBase}
            />
          )}

          {phase === 'idle' && !referencePreviewUrl && (
            <IdeaEmptyState onCreateNew={handleCreateNewClick} onReimagine={handleReimagineClick} onExampleSelected={handleExampleSelected} />
          )}

          <a
            href="/imagem-por-texto"
            className="mt-2 self-start text-xs text-ink-muted transition hover:text-sapphire"
          >
            {messages.ideaGenerator.crossSellToTextToImage.text}{' '}
            <span className="font-medium text-sapphire">{messages.ideaGenerator.crossSellToTextToImage.cta}</span>
          </a>

          <RecentGenerations title={messages.history.recentTests} entries={history.filter(isIdeaGeneratorHistoryEntry)} />
        </div>

        <div
          ref={settingsPanelRef}
          className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-t border-border bg-surface px-5 py-6 lg:w-[28%] lg:border-l lg:border-t-0"
        >
          <IdeaEngineTierSelector
            engines={engines}
            value={settings.engine}
            onChange={(engine) => setSettings((prev) => ({ ...prev, engine }))}
            disabled={isGenerating}
          />

          <ReferenceImageUpload
            previewUrl={referencePreviewUrl}
            onFileSelected={handleReferenceFileSelected}
            onClear={handleClearReferenceFile}
            disabled={isGenerating}
            compact
          />

          <EnvironmentSelector
            value={settings.environment}
            onChange={(environment) =>
              setSettings((prev) => ({ ...prev, environment, goal: IDEA_GOALS_BY_ENVIRONMENT[environment][0] }))
            }
            disabled={isGenerating}
          />

          <SpaceSelector
            environment={settings.environment}
            value={settings.space}
            onChange={(space) => setSettings((prev) => ({ ...prev, space }))}
            disabled={isGenerating}
          />

          <IdeaGoalSelector
            environment={settings.environment}
            value={settings.goal}
            onChange={(goal) => setSettings((prev) => ({ ...prev, goal }))}
            disabled={isGenerating}
          />

          <IdeaStyleSelector value={settings.style} onChange={(style) => setSettings((prev) => ({ ...prev, style }))} disabled={isGenerating} />

          <IdeaDetailsField
            value={settings.details ?? ''}
            onChange={(details) => setSettings((prev) => ({ ...prev, details }))}
            disabled={isGenerating}
          />

          {hasReferenceImage && (
            <>
              <ArchitecturePreservation
                value={settings.preservation}
                onChange={(preservation) => setSettings((prev) => ({ ...prev, preservation }))}
                disabled={isGenerating}
              />
              <TransformationLevelControl
                value={settings.transformation}
                onChange={(transformation) => setSettings((prev) => ({ ...prev, transformation }))}
                disabled={isGenerating}
              />
            </>
          )}

          <div>
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">
              {messages.ideaGenerator.imageCount.label}
            </span>
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface-secondary p-1">
              {([1, 2, 4] as const).map((count) => (
                <button
                  key={count}
                  type="button"
                  disabled={isGenerating}
                  onClick={() => setSettings((prev) => ({ ...prev, count }))}
                  className={`rounded-md py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    settings.count === count ? 'bg-surface text-sapphire shadow-card' : 'text-ink-secondary hover:text-ink'
                  }`}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          <IdeaAdvancedOptions
            settings={settings}
            onSettingsChange={setSettings}
            hasReferenceImage={hasReferenceImage}
            disabled={isGenerating}
          />

          <div className="mt-2 border-t border-border pt-4">
            <IdeaCreditGenerationButton
              totalCost={totalCost}
              ideaCount={settings.count}
              walletBalance={walletBalance}
              walletLoaded={walletLoaded}
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
