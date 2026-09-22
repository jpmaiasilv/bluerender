import { useEffect, useRef, useState } from 'react';
import { Download, ImagePlus, Loader2 } from 'lucide-react';
import { ToolLayout } from '../components/ToolLayout';
import { UploadDropzone } from '../components/UploadDropzone';
import { CompareSlider } from '../components/CompareSlider';
import { ErrorPanel } from '../components/ErrorPanel';
import { useWalletContext } from '../layouts/RootLayout';
import { useLanguage } from '../i18n';
import {
  ApiError,
  fetchUpscaleConfig,
  fetchUpscaleHistory,
  pollUpscaleJobUntilDone,
  submitUpscaleJob,
} from '../lib/api';
import { JobErrorPayload, UpscaleConfig, UpscaleHistoryItem, UpscaleResultPayload, UpscaleScale, UpscaleStage } from '../types';

type Phase = 'idle' | 'generating' | 'complete' | 'error';

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** "Melhorar para 4K" only when the output is actually ~4K — never promises a resolution the job won't deliver. */
function is4k(width: number, height: number): boolean {
  return Math.max(width, height) >= 3840;
}

export function UpscalePage() {
  const { messages } = useLanguage();
  const t = messages.upscale;
  const { walletBalance, refreshWallet } = useWalletContext();

  const [config, setConfig] = useState<UpscaleConfig | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [naturalDims, setNaturalDims] = useState<{ width: number; height: number } | null>(null);
  const [scale, setScale] = useState<UpscaleScale>(2);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState<UpscaleStage>('validating');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<UpscaleResultPayload | null>(null);
  const [error, setError] = useState<JobErrorPayload | null>(null);
  const [history, setHistory] = useState<UpscaleHistoryItem[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchUpscaleConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
    void loadHistory();
    return () => {
      abortRef.current?.abort();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function loadHistory() {
    try {
      setHistory(await fetchUpscaleHistory());
    } catch {
      // History is a nice-to-have here — a failed fetch just leaves the list empty.
    }
  }

  function handleFileSelected(selected: File) {
    if (selected.type === 'image/webp') {
      setInlineError(t.unsupportedFormat);
      return;
    }
    setInlineError(null);
    idempotencyKeyRef.current = newIdempotencyKey();
    setFile(selected);
    setResult(null);
    setError(null);
    setPhase('idle');
    const url = URL.createObjectURL(selected);
    setPreviewUrl(url);
    const img = new Image();
    img.onload = () => setNaturalDims({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = url;
  }

  function handleClear() {
    setFile(null);
    setPreviewUrl(null);
    setNaturalDims(null);
    setResult(null);
    setError(null);
    setInlineError(null);
    setPhase('idle');
  }

  const scaleOption = config?.scales.find((s) => s.scale === scale);
  const credits = scaleOption?.credits ?? 0;
  const outputWidth = naturalDims ? naturalDims.width * scale : null;
  const outputHeight = naturalDims ? naturalDims.height * scale : null;
  const outputMegapixels = outputWidth && outputHeight ? (outputWidth * outputHeight) / 1_000_000 : null;
  const exceedsOutputLimit = Boolean(config && outputMegapixels && outputMegapixels > config.maxOutputMegapixels);
  const canAfford = walletBalance >= credits;
  const canGenerate = Boolean(file) && Boolean(config) && !exceedsOutputLimit && canAfford && phase !== 'generating';

  async function runGeneration() {
    if (!file || !naturalDims) return;
    setPhase('generating');
    setStage('validating');
    setError(null);
    const startedAt = Date.now();
    timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { jobId } = await submitUpscaleJob(file, scale, idempotencyKeyRef.current);
      const final = await pollUpscaleJobUntilDone(
        jobId,
        (status) => setStage(status.stage),
        controller.signal
      );
      if (!final.result) throw new ApiError('UNKNOWN_ERROR', 'The upscale finished without a result.');
      setResult(final.result);
      setPhase('complete');
      refreshWallet();
      void loadHistory();
    } catch (err) {
      const payload =
        err instanceof ApiError
          ? { code: err.code, message: err.message, details: err.details }
          : { code: 'UNKNOWN_ERROR' as const, message: 'An unexpected error occurred.' };
      setError(payload);
      setPhase('error');
      refreshWallet();
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }

  function openHistoryItem(item: UpscaleHistoryItem) {
    if (!item.originalUrl || !item.resultUrl) return;
    setResult({
      jobId: item.id,
      originalUrl: item.originalUrl,
      resultUrl: item.resultUrl,
      originalWidth: item.originalWidth,
      originalHeight: item.originalHeight,
      outputWidth: item.outputWidth,
      outputHeight: item.outputHeight,
      scale: item.scale,
      model: item.model,
      creditsCharged: item.creditsCharged,
    });
    setPhase('complete');
    setFile(null);
    setPreviewUrl(null);
  }

  const primaryButtonLabel =
    outputWidth && outputHeight ? (is4k(outputWidth, outputHeight) ? t.primaryButton4k : t.primaryButtonGeneric) : t.primaryButton4k;

  return (
    <ToolLayout title={t.title} description={t.description}>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-y-auto p-6">
          <p className="mb-4 text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.auxiliaryText}</p>

          {phase === 'generating' && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-surface-secondary p-10 text-center">
              <Loader2 size={28} className="animate-spin text-sapphire" />
              <p className="text-sm font-medium text-ink">{t.states[stateKey(stage)]}</p>
              <p className="text-xs text-ink-muted">{(elapsedMs / 1000).toFixed(0)}s</p>
            </div>
          )}

          {phase === 'error' && error && <ErrorPanel error={error} onRetry={() => void runGeneration()} />}

          {phase === 'complete' && result && (
            <div className="flex flex-col gap-4">
              <h2 className="text-xs font-medium uppercase tracking-wide text-ink-secondary">{messages.result.compare}</h2>
              <CompareSlider beforeSrc={result.originalUrl} afterSrc={result.resultUrl} beforeLabel={t.originalResolution} afterLabel={t.finalResolution} />
              <p className="text-center text-xs text-ink-muted">
                {t.originalResolution}: {result.originalWidth} × {result.originalHeight} · {t.finalResolution}: {result.outputWidth} × {result.outputHeight} · {result.scale}×
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <a
                  href={result.resultUrl}
                  download
                  className="flex items-center gap-1.5 rounded-lg bg-sapphire px-4 py-2 text-sm font-medium text-white transition hover:bg-sapphire-dark"
                >
                  <Download size={15} />
                  {t.download}
                </a>
                <button
                  type="button"
                  onClick={handleClear}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink-secondary transition hover:border-sapphire/40"
                >
                  <ImagePlus size={15} />
                  {t.newImage}
                </button>
              </div>
            </div>
          )}

          {(phase === 'idle') && (
            <UploadDropzone
              label={t.uploadLabel}
              dragDropText={t.uploadDragDrop}
              previewUrl={previewUrl}
              onFileSelected={handleFileSelected}
              onClear={handleClear}
              hideLabel
              replaceLabel={t.newImage}
            />
          )}
          {phase === 'idle' && inlineError && <p className="mt-2 text-xs text-danger">{inlineError}</p>}

          <div className="mt-8">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.history.title}</h3>
            {history.length === 0 ? (
              <p className="text-xs text-ink-muted">{t.history.empty}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {history.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openHistoryItem(item)}
                    disabled={!item.originalUrl || !item.resultUrl}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2.5 text-left transition hover:border-sapphire/40 hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-secondary">
                      {item.resultUrl && <img src={item.resultUrl} alt="" className="h-full w-full object-cover" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">
                        {item.scale}× · {item.outputWidth} × {item.outputHeight}
                      </p>
                      <p className="truncate text-xs text-ink-muted">
                        {new Date(item.createdAt).toLocaleString()} · {t.states[stateKey(item.status)]}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="w-[340px] shrink-0 border-l border-border p-6">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-secondary">{t.scaleLabel}</span>
          <div className="mb-4 grid grid-cols-2 gap-2">
            {(config?.scales ?? [{ scale: 2 as UpscaleScale, credits: 0 }, { scale: 4 as UpscaleScale, credits: 0 }]).map((opt) => (
              <button
                key={opt.scale}
                type="button"
                disabled={phase === 'generating'}
                onClick={() => setScale(opt.scale)}
                className={`rounded-lg border p-3 text-center transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  scale === opt.scale ? 'border-sapphire bg-sapphire-light shadow-glow' : 'border-border bg-surface hover:border-sapphire/40'
                }`}
              >
                <span className={`block text-sm font-medium ${scale === opt.scale ? 'text-sapphire' : 'text-ink'}`}>
                  {opt.scale === 2 ? t.scale2x : t.scale4x}
                </span>
                <span className="block text-xs text-ink-secondary">{messages.wallet.creditsSuffix(opt.credits)}</span>
              </button>
            ))}
          </div>

          {naturalDims && (
            <div className="mb-4 space-y-1 rounded-lg border border-border bg-surface-secondary p-3 text-xs">
              <p className="flex justify-between text-ink-secondary">
                <span>{t.originalResolution}</span>
                <span className="text-ink">{naturalDims.width} × {naturalDims.height}</span>
              </p>
              <p className="flex justify-between text-ink-secondary">
                <span>{t.finalResolution}</span>
                <span className="text-ink">{outputWidth} × {outputHeight}</span>
              </p>
              <p className="flex justify-between text-ink-secondary">
                <span>{t.estimatedCost}</span>
                <span className="text-ink">{messages.wallet.creditsSuffix(credits)}</span>
              </p>
            </div>
          )}

          {exceedsOutputLimit && config && <p className="mb-3 text-xs text-danger">{t.tooLargeOutput(config.maxOutputMegapixels)}</p>}
          {!canAfford && file && <p className="mb-3 text-xs text-danger">{messages.wallet.insufficientMessage(credits, walletBalance)}</p>}

          <button
            type="button"
            disabled={!canGenerate}
            onClick={() => void runGeneration()}
            className="w-full rounded-lg bg-sapphire px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sapphire-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === 'generating' ? `${primaryButtonLabel}…` : primaryButtonLabel}
          </button>
          {file && <p className="mt-2 text-center text-xs text-ink-muted">{messages.wallet.balancePreview(walletBalance, walletBalance - credits)}</p>}
        </div>
      </div>
    </ToolLayout>
  );
}

type UpscaleStateKey = 'idle' | 'loaded' | 'validating' | 'uploading' | 'queued' | 'processing' | 'saving' | 'complete' | 'failed' | 'cancelled' | 'timedOut';

function stateKey(stage: UpscaleStage | 'queued' | 'processing' | 'completed'): UpscaleStateKey {
  switch (stage) {
    case 'validating':
      return 'validating';
    case 'uploading':
      return 'uploading';
    case 'queued':
      return 'queued';
    case 'processing':
      return 'processing';
    case 'downloading':
    case 'saving':
      return 'saving';
    case 'complete':
    case 'completed':
      return 'complete';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'timed_out':
      return 'timedOut';
    default:
      return 'processing';
  }
}
