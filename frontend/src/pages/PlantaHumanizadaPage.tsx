import { useCallback, useEffect, useRef, useState } from 'react';
import { UploadDropzone } from '../components/UploadDropzone';
import { ErrorPanel } from '../components/ErrorPanel';
import { CompareSlider } from '../components/CompareSlider';
import { HumanizedFloorplanSimpleGeneratingStatus } from '../components/planta-humanizada/HumanizedFloorplanSimpleGeneratingStatus';
import { PlantaHumanizadaSimpleSettingsPanel } from '../components/planta-humanizada/PlantaHumanizadaSimpleSettingsPanel';
import { PlantaHumanizadaSimpleResultActions } from '../components/planta-humanizada/PlantaHumanizadaSimpleResultActions';
import { HistoryLoadState, PlantaHumanizadaHistory } from '../components/planta-humanizada/PlantaHumanizadaHistory';
import { PlantaHumanizadaHistoryModal } from '../components/planta-humanizada/PlantaHumanizadaHistoryModal';
import { ConfirmGenerationModal } from '../components/planta-humanizada/ConfirmGenerationModal';
import {
  ApiError,
  deleteHumanizedFloorplanSimpleGeneration,
  fetchHumanizedFloorplanSimpleConfig,
  fetchHumanizedFloorplanSimpleGeneration,
  fetchHumanizedFloorplanSimpleHistory,
  pollHumanizedFloorplanSimpleJobUntilDone,
  submitHumanizedFloorplanSimpleGenerate,
} from '../lib/api';
import {
  DEFAULT_HUMANIZED_FLOORPLAN_SIMPLE_SETTINGS,
  HUMANIZED_FLOORPLAN_FURNITURE_LEVELS,
  HUMANIZED_FLOORPLAN_LIGHTING_OPTIONS,
  HUMANIZED_FLOORPLAN_OUTPUT_FORMATS,
  HUMANIZED_FLOORPLAN_SIMPLE_STYLES,
  HUMANIZED_FLOORPLAN_SURROUNDINGS_KINDS,
  HUMANIZED_FLOORPLAN_SURROUNDINGS_OPTIONS,
  HUMANIZED_FLOORPLAN_TEXT_MODES,
  HumanizedFloorplanGenerationMode,
  HumanizedFloorplanSimpleHistoryItem,
  HumanizedFloorplanSimpleJobStage,
  HumanizedFloorplanSimpleSettings,
  JobErrorPayload,
  HumanizedFloorplanSimpleConfig,
} from '../types';
import { useWalletContext } from '../layouts/RootLayout';
import { useLanguage } from '../i18n';

/**
 * Planta Humanizada — the tool's page. Upload the original plan (the ONLY
 * source of architecture), optionally a style reference, pick style /
 * lighting / surroundings, generate for the backend-defined cost, then
 * download or reuse from the history below. Every credit/idempotency/
 * ownership rule is enforced server-side; this page only reflects it.
 */

type Phase = 'idle' | 'generating' | 'complete' | 'error';

/** A past generation whose stored original (and optionally reference) is being reused instead of a fresh upload. */
interface SourceGeneration {
  id: string;
  originalUrl: string | null;
  referenceUrl: string | null;
  hasReference: boolean;
}

function pickOption<T extends string>(list: readonly T[], value: string | null, fallback: T): T {
  return value && (list as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Legacy records may lack the newer fields — anything unknown falls back to the same defaults a fresh form uses. */
function settingsFromItem(item: HumanizedFloorplanSimpleHistoryItem): HumanizedFloorplanSimpleSettings {
  const d = DEFAULT_HUMANIZED_FLOORPLAN_SIMPLE_SETTINGS;
  return {
    style: pickOption(HUMANIZED_FLOORPLAN_SIMPLE_STYLES, item.style, d.style),
    lighting: pickOption(HUMANIZED_FLOORPLAN_LIGHTING_OPTIONS, item.lighting, d.lighting),
    surroundings: pickOption(HUMANIZED_FLOORPLAN_SURROUNDINGS_OPTIONS, item.surroundings, d.surroundings),
    surroundingsKind: pickOption(HUMANIZED_FLOORPLAN_SURROUNDINGS_KINDS, item.surroundingsKind, d.surroundingsKind),
    customSurroundings: item.customSurroundings ?? '',
    textMode: pickOption(HUMANIZED_FLOORPLAN_TEXT_MODES, item.textMode, d.textMode),
    furnitureLevel: pickOption(HUMANIZED_FLOORPLAN_FURNITURE_LEVELS, item.furnitureLevel, d.furnitureLevel),
    outputFormat: pickOption(HUMANIZED_FLOORPLAN_OUTPUT_FORMATS, item.outputFormat, d.outputFormat),
    customInstructions: item.customInstructions ?? '',
  };
}

type PendingConfirm = { kind: 'again' } | { kind: 'repeat'; item: HumanizedFloorplanSimpleHistoryItem } | null;

export function PlantaHumanizadaPage() {
  const { walletBalance, walletLoaded, refreshWallet } = useWalletContext();
  const { messages } = useLanguage();
  const t = messages.plantaHumanizada.simpleFlow;

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referencePreviewUrl, setReferencePreviewUrl] = useState<string | null>(null);
  const [source, setSource] = useState<SourceGeneration | null>(null);
  const [keepSourceReference, setKeepSourceReference] = useState(false);
  const [settings, setSettings] = useState<HumanizedFloorplanSimpleSettings>(DEFAULT_HUMANIZED_FLOORPLAN_SIMPLE_SETTINGS);

  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState<HumanizedFloorplanSimpleJobStage>('uploading');
  const [jobStartedAt, setJobStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<HumanizedFloorplanSimpleHistoryItem | null>(null);
  const [error, setError] = useState<JobErrorPayload | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [config, setConfig] = useState<HumanizedFloorplanSimpleConfig | null>(null);
  // 'standard' (Blue Render) is always the default; switching modes never clears uploads or settings.
  const [mode, setMode] = useState<HumanizedFloorplanGenerationMode>('standard');
  // The mode of the generation currently running / just finished (the progress list depends on it, not on the selector).
  const [runningMode, setRunningMode] = useState<HumanizedFloorplanGenerationMode>('standard');
  const [history, setHistory] = useState<HumanizedFloorplanSimpleHistoryItem[]>([]);
  const [historyState, setHistoryState] = useState<HistoryLoadState>('loading');
  const [openItem, setOpenItem] = useState<HumanizedFloorplanSimpleHistoryItem | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);

  const abortRef = useRef<AbortController | null>(null);
  const submittingGuardRef = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);

  const modes = config?.humanizedFloorplan.modes ?? null;
  const modeAvailable = (m: HumanizedFloorplanGenerationMode): boolean => (m === 'standard' ? true : Boolean(modes?.[m].available));
  const modeCost = (m: HumanizedFloorplanGenerationMode): number | null => modes?.[m].cost ?? null;
  /** What the SELECTED mode costs, exactly as the backend reported it. */
  const costCredits = modeCost(mode);

  // If the premium mode is (or becomes) unavailable, fall back to the standard mode instead of leaving an unusable selection.
  useEffect(() => {
    if (modes && mode === 'astra' && !modes.astra.available) setMode('standard');
  }, [modes, mode]);

  useEffect(() => {
    let cancelled = false;
    fetchHumanizedFloorplanSimpleConfig()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => {
        // Left null — the button stays disabled; the cost is never guessed on the client.
      });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryState((s) => (s === 'ready' ? s : 'loading'));
    try {
      setHistory(await fetchHumanizedFloorplanSimpleHistory());
      setHistoryState('ready');
    } catch {
      setHistoryState('error');
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

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

  function updateSettings(patch: Partial<HumanizedFloorplanSimpleSettings>) {
    setSettings((s) => ({ ...s, ...patch }));
  }

  function handleFileSelected(next: File) {
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
    setSource(null);
    setKeepSourceReference(false);
    setPhase('idle');
    setResult(null);
    setError(null);
    setNotice(null);
  }

  function handleClearFile() {
    setFile(null);
    setPreviewUrl(null);
    setSource(null);
    setKeepSourceReference(false);
    setPhase('idle');
    setResult(null);
    setError(null);
    setNotice(null);
  }

  function handleReferenceSelected(next: File) {
    setReferenceFile(next);
    setReferencePreviewUrl(URL.createObjectURL(next));
    setKeepSourceReference(false);
  }

  function handleReferenceClear() {
    setReferenceFile(null);
    setReferencePreviewUrl(null);
    setKeepSourceReference(false);
  }

  /**
   * The ONLY place this page reaches the paid endpoint. A fresh idempotency
   * key per attempt (a re-generation is a genuinely new paid generation);
   * the in-flight guard plus the disabled button stop double clicks, and
   * the server additionally treats a repeated key as the same generation.
   */
  async function runGeneration(overrides: { source?: SourceGeneration | null; keepReference?: boolean; settings?: HumanizedFloorplanSimpleSettings; file?: File | null; referenceFile?: File | null; mode?: HumanizedFloorplanGenerationMode } = {}) {
    const effectiveMode = overrides.mode ?? mode;
    const effectiveFile = overrides.file !== undefined ? overrides.file : file;
    const effectiveReferenceFile = overrides.referenceFile !== undefined ? overrides.referenceFile : referenceFile;
    const effectiveSource = overrides.source !== undefined ? overrides.source : source;
    const effectiveSettings = overrides.settings ?? settings;
    const effectiveKeepReference = overrides.keepReference ?? keepSourceReference;
    if ((!effectiveFile && !effectiveSource) || submittingGuardRef.current) return;
    submittingGuardRef.current = true;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsSubmitting(true);
    setRunningMode(effectiveMode);
    setPhase('generating');
    setStage('uploading');
    setElapsedMs(0);
    setError(null);
    setResult(null);
    setNotice(null);
    const idempotencyKey = crypto.randomUUID();

    try {
      const { jobId, startedAt } = await submitHumanizedFloorplanSimpleGenerate({
        image: effectiveFile,
        styleReference: effectiveReferenceFile,
        settings: effectiveSettings,
        generationMode: effectiveMode,
        idempotencyKey,
        sourceGenerationId: !effectiveFile && effectiveSource ? effectiveSource.id : null,
        reuseSourceReference: !effectiveFile && !effectiveReferenceFile && effectiveKeepReference,
      });
      setJobStartedAt(startedAt);
      refreshWallet();

      const final = await pollHumanizedFloorplanSimpleJobUntilDone(jobId, (status) => setStage(status.stage), controller.signal);
      if (!final.result) throw new ApiError('UNKNOWN_ERROR', 'The generation completed without a result.');

      setResult(final.result);
      setPhase('complete');
    } catch (err) {
      const apiError =
        err instanceof ApiError
          ? { code: err.code, message: t.errorMessages[err.code] ?? t.errorMessages.UNKNOWN_ERROR }
          : { code: 'UNKNOWN_ERROR' as const, message: t.errorMessages.UNKNOWN_ERROR };
      setError({ ...apiError, message: `${apiError.message} ${t.failureNoCharge}` });
      setPhase('error');
    } finally {
      setIsSubmitting(false);
      submittingGuardRef.current = false;
      refreshWallet();
      void loadHistory();
    }
  }

  function requestGenerateAgain() {
    if (result) setPendingConfirm({ kind: 'again' });
  }

  function confirmPending() {
    const pending = pendingConfirm;
    setPendingConfirm(null);
    if (!pending) return;
    if (pending.kind === 'again' && result) {
      void runGeneration({
        source: { id: result.id, originalUrl: result.originalUrl, referenceUrl: result.referenceUrl, hasReference: result.hasReference },
        keepReference: result.hasReference && !referenceFile,
        file: null,
      });
    } else if (pending.kind === 'repeat') {
      const item = pending.item;
      const itemSettings = settingsFromItem(item);
      setOpenItem(null);
      setFile(null);
      setPreviewUrl(null);
      setReferenceFile(null);
      setReferencePreviewUrl(null);
      setSettings(itemSettings);
      const repeatMode = modeAvailable(item.generationMode) ? item.generationMode : 'standard';
      setMode(repeatMode);
      void runGeneration({
        file: null,
        referenceFile: null,
        source: { id: item.id, originalUrl: item.originalUrl, referenceUrl: item.referenceUrl, hasReference: item.hasReference },
        keepReference: item.hasReference,
        settings: itemSettings,
        mode: repeatMode,
      });
    }
  }

  /** "Criar nova versão": loads a past generation's settings and stored files into the controls — nothing is generated or charged until the user presses the button. */
  function handleNewVersion(item: HumanizedFloorplanSimpleHistoryItem) {
    setSettings(settingsFromItem(item));
    setMode(modeAvailable(item.generationMode) ? item.generationMode : 'standard');
    setFile(null);
    setPreviewUrl(null);
    setReferenceFile(null);
    setReferencePreviewUrl(null);
    setSource({ id: item.id, originalUrl: item.originalUrl, referenceUrl: item.referenceUrl, hasReference: item.hasReference });
    setKeepSourceReference(item.hasReference);
    setPhase('idle');
    setResult(null);
    setError(null);
    setNotice(t.newVersionApplied);
    setOpenItem(null);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Opens the viewer at once with the light list item, then loads the full detail (signed URLs for original/reference/downloads). */
  async function handleOpenItem(item: HumanizedFloorplanSimpleHistoryItem) {
    setOpenItem(item);
    if (item.status === 'processing') return;
    try {
      const full = await fetchHumanizedFloorplanSimpleGeneration(item.id);
      setOpenItem((current) => (current?.id === item.id ? full : current));
    } catch {
      // Keep the light item: the viewer still shows what it has.
    }
  }

  async function handleDeleteItem(item: HumanizedFloorplanSimpleHistoryItem) {
    await deleteHumanizedFloorplanSimpleGeneration(item.id);
    setOpenItem(null);
    setHistory((h) => h.filter((x) => x.id !== item.id));
    if (source?.id === item.id) setSource(null);
  }

  // "Gerar novamente" is charged for the mode selected NOW; "Repetir configurações" repeats the mode it was generated with.
  const pendingMode: HumanizedFloorplanGenerationMode =
    pendingConfirm?.kind === 'repeat' ? (modeAvailable(pendingConfirm.item.generationMode) ? pendingConfirm.item.generationMode : 'standard') : mode;
  const pendingCost = modeCost(pendingMode);

  const hasOriginal = Boolean(file) || Boolean(source);
  const isGenerating = phase === 'generating' || isSubmitting;
  const canGenerate = hasOriginal && !isGenerating && costCredits !== null && walletLoaded && walletBalance >= costCredits;
  const originalPreview = previewUrl ?? source?.originalUrl ?? null;
  const shownReferencePreview = referencePreviewUrl ?? (keepSourceReference ? (source?.referenceUrl ?? null) : null);

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto">
      <div ref={topRef} className="flex flex-col lg:flex-row">
        <div className="flex min-h-[320px] min-w-0 flex-1 flex-col p-4 sm:p-6 lg:min-h-[420px]">
          {notice && phase === 'idle' && <p className="mb-3 rounded-lg bg-sapphire/10 px-3 py-2 text-sm text-sapphire">{notice}</p>}

          {phase === 'generating' && <HumanizedFloorplanSimpleGeneratingStatus elapsedMs={elapsedMs} stage={stage} mode={runningMode} />}

          {phase === 'error' && error && (
            <div className="flex flex-col lg:sticky lg:top-6">
              <ErrorPanel error={error} onRetry={() => setPhase('idle')} />
            </div>
          )}

          {phase === 'complete' && result && (
            <div className="flex flex-1 flex-col gap-4">
              <h2 className="text-xs font-medium uppercase tracking-wide text-ink-secondary">{messages.result.compare}</h2>
              {result.originalUrl && result.resultUrl ? (
                <CompareSlider beforeSrc={result.originalUrl} afterSrc={result.resultUrl} beforeLabel={t.originalBadge} afterLabel={messages.plantaHumanizada.simpleFlow.modal.after} />
              ) : null}
              <PlantaHumanizadaSimpleResultActions
                downloadPngUrl={result.downloadPngUrl}
                downloadJpgUrl={result.downloadJpgUrl}
                onGenerateAgain={requestGenerateAgain}
                onNewImage={handleClearFile}
              />
            </div>
          )}

          {phase === 'idle' && (
            <div className="flex flex-col lg:sticky lg:top-6">
              <span className="mb-2 self-start rounded-full bg-ink/5 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">{t.originalBadge}</span>
              <UploadDropzone
                label={messages.plantaHumanizada.uploadLabel}
                dragDropText={messages.plantaHumanizada.uploadDragDrop}
                previewUrl={originalPreview}
                onFileSelected={handleFileSelected}
                onClear={handleClearFile}
                hideLabel
                maxSizeBytes={config?.maxFileSizeBytes}
                fileTooLargeText={config ? t.fileTooLarge(Math.floor(config.maxFileSizeBytes / (1024 * 1024))) : undefined}
                replaceLabel={t.replaceFile}
              />
            </div>
          )}
        </div>

        <div className="w-full shrink-0 lg:w-[360px]">
          <PlantaHumanizadaSimpleSettingsPanel
            mode={mode}
            onModeChange={setMode}
            modes={modes}
            settings={settings}
            onChange={updateSettings}
            referencePreviewUrl={shownReferencePreview}
            onReferenceSelected={handleReferenceSelected}
            onReferenceClear={handleReferenceClear}
            maxFileSizeBytes={config?.maxFileSizeBytes ?? null}
            costCredits={costCredits}
            walletBalance={walletBalance}
            disabled={isGenerating}
            canGenerate={canGenerate}
            isGenerating={isGenerating}
            onGenerate={() => void runGeneration()}
          />
        </div>
      </div>

      <PlantaHumanizadaHistory items={history} state={historyState} onRetry={() => void loadHistory()} onOpen={(item) => void handleOpenItem(item)} />

      <PlantaHumanizadaHistoryModal
        item={openItem}
        onClose={() => setOpenItem(null)}
        onNewVersion={handleNewVersion}
        onRepeat={(item) => setPendingConfirm({ kind: 'repeat', item })}
        onDelete={handleDeleteItem}
      />

      {pendingCost !== null && (
        <ConfirmGenerationModal open={pendingConfirm !== null} costCredits={pendingCost} walletBalance={walletBalance} onConfirm={confirmPending} onCancel={() => setPendingConfirm(null)} />
      )}
    </div>
  );
}
