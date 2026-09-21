import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ToolLayout } from '../components/ToolLayout';
import { PromptComposer } from '../components/text-to-image/PromptComposer';
import { EngineTierSelector } from '../components/text-to-image/EngineTierSelector';
import { CategorySelect } from '../components/text-to-image/CategorySelect';
import { AdvancedGenerationOptions } from '../components/text-to-image/AdvancedGenerationOptions';
import { CreditGenerationButton } from '../components/text-to-image/CreditGenerationButton';
import { TextToImageLoadingStatus } from '../components/text-to-image/TextToImageLoadingStatus';
import { GenerationEmptyState } from '../components/text-to-image/GenerationEmptyState';
import { GenerationGallery } from '../components/text-to-image/GenerationGallery';
import { ErrorPanel } from '../components/ErrorPanel';
import { SelectField } from '../components/SelectField';
import { RecentGenerations } from '../components/history/RecentGenerations';
import { ApiError, fetchTextToImageEngines, pollTextToImageJobUntilDone, submitTextToImageJob } from '../lib/api';
import { loadHistory, saveHistoryEntry } from '../lib/history';
import { T2I_ASPECT_RATIO_VALUES, T2I_IMAGE_COUNT_VALUES, T2I_STYLE_VALUES } from '../lib/options';
import {
  HistoryEntry,
  isTextToImageHistoryEntry,
  JobErrorPayload,
  JobStage,
  T2IEngineInfo,
  T2IGeneratedImage,
  T2IJobResultPayload,
  TextToImageSettings,
} from '../types';
import { useWalletContext } from '../layouts/RootLayout';
import { useLanguage } from '../i18n';

type Phase = 'idle' | 'generating' | 'complete' | 'error';

const DEFAULT_SETTINGS: TextToImageSettings = {
  prompt: '',
  engine: 'pro',
  count: 1,
  aspectRatio: 'automatic',
  style: 'livre',
  projectType: 'livre',
  lighting: 'automatica',
  environment: 'preserve_original',
  led: 'automatic',
  creativity: 'equilibrada',
};

export function TextToImagePage() {
  const { messages } = useLanguage();
  const navigate = useNavigate();
  const { walletBalance, refreshWallet, openUpgradeModal } = useWalletContext();

  const [engines, setEngines] = useState<T2IEngineInfo[]>([]);
  const [settings, setSettings] = useState<TextToImageSettings>(DEFAULT_SETTINGS);

  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referencePreviewUrl, setReferencePreviewUrl] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState<JobStage>('uploading');
  const [result, setResult] = useState<T2IJobResultPayload | null>(null);
  const [lastSettings, setLastSettings] = useState<TextToImageSettings | null>(null);
  const [error, setError] = useState<JobErrorPayload | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
    fetchTextToImageEngines()
      .then((list) => {
        setEngines(list);
        // The featured (non-legacy) engines always come first — see config/textToImageEngines.ts.
        if (list.length > 0) setSettings((prev) => ({ ...prev, engine: list[0].id }));
      })
      .catch(() => setEngines([]));
  }, []);

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

  async function handleUseAsReference(image: T2IGeneratedImage) {
    try {
      const res = await fetch(image.imageUrl);
      const blob = await res.blob();
      const extension = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
      const file = new File([blob], `${image.requestId}.${extension}`, { type: blob.type });
      handleReferenceFileSelected(file);
    } catch {
      // Non-critical convenience action — silently ignore on failure.
    }
  }

  function handleNew() {
    setSettings((prev) => ({ ...prev, prompt: '' }));
    handleClearReferenceFile();
    setResult(null);
    setError(null);
    setPhase('idle');
  }

  function handleReusePrompt() {
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
      const { jobId } = await submitTextToImageJob(settings, referenceFile);

      const final = await pollTextToImageJobUntilDone(jobId, (status) => setStage(status.stage), controller.signal);

      if (!final.result) throw new ApiError('UNKNOWN_ERROR', 'The generation completed without a result.');

      setResult(final.result);
      setLastSettings(settings);
      setPhase('complete');

      refreshWallet();

      const firstImage = final.result.images[0];
      const entry: HistoryEntry = {
        toolId: 'imagemPorTexto',
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
  const canGenerate = Boolean(settings.prompt.trim()) && Boolean(selectedEngine) && !isGenerating && canAfford;

  return (
    <ToolLayout
      title={messages.nav.items.imagemPorTexto}
      description={messages.toolDescriptions.imagemPorTexto}
      actions={
        <>
          <button
            type="button"
            onClick={() => navigate('/historico?tool=imagemPorTexto')}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
          >
            {messages.textToImage.toolbar.history}
          </button>
          {(result || settings.prompt) && (
            <button
              type="button"
              onClick={handleNew}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
            >
              {messages.textToImage.toolbar.new}
            </button>
          )}
        </>
      }
    >
      {/* Same workspace(left) + settings-panel(right) architecture as the Idea Generator page — see IdeaGeneratorPage.tsx. Only the fields inside the right panel and the workspace's protagonist (prompt vs. reference image) differ between the two tools. */}
      <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-6 lg:w-[72%]">
          <PromptComposer
            prompt={settings.prompt}
            onPromptChange={(prompt) => setSettings((prev) => ({ ...prev, prompt }))}
            settings={settings}
            disabled={isGenerating}
          />

          {phase === 'generating' && <TextToImageLoadingStatus stage={stage} />}

          {phase === 'error' && error && <ErrorPanel error={error} onRetry={runGeneration} />}

          {phase === 'complete' && result && result.images.length > 0 && (
            <GenerationGallery
              images={result.images}
              requestedCount={result.requestedCount}
              onUseAsReference={handleUseAsReference}
              onReusePrompt={handleReusePrompt}
            />
          )}

          {phase === 'idle' && (
            <GenerationEmptyState onExampleSelected={(example) => setSettings((prev) => ({ ...prev, prompt: example }))} />
          )}

          <a href="/gerador-de-ideias" className="mt-2 self-start text-xs text-ink-muted transition hover:text-sapphire">
            {messages.textToImage.crossSellToIdeaGenerator.text}{' '}
            <span className="font-medium text-sapphire">{messages.textToImage.crossSellToIdeaGenerator.cta}</span>
          </a>

          <RecentGenerations title={messages.history.recentTests} entries={history.filter(isTextToImageHistoryEntry)} />
        </div>

        <div className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-t border-border bg-surface px-5 py-6 lg:w-[28%] lg:border-l lg:border-t-0">
          <EngineTierSelector
            engines={engines}
            value={settings.engine}
            onChange={(engine) => setSettings((prev) => ({ ...prev, engine }))}
            disabled={isGenerating}
          />

          <CategorySelect
            value={settings.projectType}
            onChange={(projectType) => setSettings((prev) => ({ ...prev, projectType }))}
            disabled={isGenerating}
          />

          <SelectField
            label={messages.textToImage.styleLabel}
            value={settings.style}
            options={T2I_STYLE_VALUES.map((v) => ({ value: v, label: messages.textToImage.styles[v] }))}
            onChange={(v) => setSettings((prev) => ({ ...prev, style: v as TextToImageSettings['style'] }))}
            disabled={isGenerating}
          />

          <SelectField
            label={messages.textToImage.aspectRatioLabel}
            value={settings.aspectRatio}
            options={T2I_ASPECT_RATIO_VALUES.map((v) => ({ value: v, label: messages.textToImage.aspectRatioOptions[v] }))}
            onChange={(v) => setSettings((prev) => ({ ...prev, aspectRatio: v as TextToImageSettings['aspectRatio'] }))}
            disabled={isGenerating}
          />

          <div>
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">
              {messages.textToImage.imageCount.label}
            </span>
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface-secondary p-1">
              {T2I_IMAGE_COUNT_VALUES.map((count) => (
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

          <AdvancedGenerationOptions
            settings={settings}
            onSettingsChange={setSettings}
            referencePreviewUrl={referencePreviewUrl}
            onReferenceFileSelected={handleReferenceFileSelected}
            onClearReferenceFile={handleClearReferenceFile}
            disabled={isGenerating}
          />

          <div className="mt-2 border-t border-border pt-4">
            <CreditGenerationButton
              totalCost={totalCost}
              imageCount={settings.count}
              walletBalance={walletBalance}
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
