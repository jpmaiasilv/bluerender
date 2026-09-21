import { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser, Hand, Maximize2, Minimize2, Paintbrush, Redo2, RotateCcw, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { HumanizedFloorplanMaskResponse } from '../../types';
import { useLanguage } from '../../i18n';
import {
  canvasToDataUrl,
  canvasToPngBlob,
  computeMaskCoverage,
  deriveOverlayFromMask,
  loadImage,
  MaskCoverage,
  paintDataUrlOntoCanvas,
} from '../../lib/humanizedFloorplanMaskCanvas';

type Tool = 'protect' | 'allow' | 'pan';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;
const MIN_BRUSH = 6;
const MAX_BRUSH = 200;
const MAX_HISTORY = 25;
const OVERLAY_COLOR = '37, 99, 235'; // sapphire-ish blue, matches the legend swatch below

export interface MaskRejectionInfo {
  reason: string;
  details?: string;
}

interface Props {
  imagePreviewUrl: string;
  autoMask: HumanizedFloorplanMaskResponse;
  walletBalance: number;
  costCredits: number;
  isSubmitting: boolean;
  rejection: MaskRejectionInfo | null;
  onConfirm: (maskBlob: Blob) => void;
  onCancel: () => void;
}

/**
 * Requirement: "Upload → criação gratuita da máscara automática → tela de
 * revisão da máscara → confirmação do usuário → geração paga" — this
 * component IS that review screen. It never calls the backend itself; the
 * paid call only happens in the parent (PlantaHumanizadaPage), and only
 * after onConfirm fires with the exact mask blob the user reviewed/edited
 * here (auto mask, verbatim, if they made no edits).
 *
 * Two canvases per layer, always the same native pixel size as the source
 * image (see humanizedFloorplanMaskCanvas.ts):
 *  - `maskCanvasRef` (off-DOM): the raw black=protected/white=editable
 *    mask — the actual source of truth exported to the backend.
 *  - `overlayCanvasRef` (on-DOM): a derived semi-transparent blue rendering
 *    of the same mask, for display only.
 * Zoom/pan is a pure CSS transform on the wrapper around both visible
 * canvases — it never touches their pixel dimensions, so the exported mask
 * always keeps the exact original resolution regardless of how the user
 * navigated while editing it.
 */
export function MaskReviewScreen({
  imagePreviewUrl,
  autoMask,
  walletBalance,
  costCredits,
  isSubmitting,
  rejection,
  onConfirm,
  onCancel,
}: Props) {
  const { messages } = useLanguage();
  const t = messages.plantaHumanizada.maskReview;

  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState<Tool>('protect');
  const [brushSize, setBrushSize] = useState(40);
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [coverage, setCoverage] = useState<MaskCoverage>({ protectedPercent: 0, editablePercent: 100 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cursorPreviewRef = useRef<HTMLDivElement>(null);

  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const panStartRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(null);
  const submittingGuardRef = useRef(false);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const toolRef = useRef(tool);
  const brushSizeRef = useRef(brushSize);
  zoomRef.current = zoom;
  panRef.current = pan;
  toolRef.current = tool;
  brushSizeRef.current = brushSize;

  const fitToScreen = useCallback(() => {
    const viewport = viewportRef.current;
    const img = imageCanvasRef.current;
    if (!viewport || !img || img.width === 0 || img.height === 0) return;
    const rect = viewport.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const scale = Math.min(rect.width / img.width, rect.height / img.height) * 0.94;
    setZoom(scale);
    setPan({ x: (rect.width - img.width * scale) / 2, y: (rect.height - img.height * scale) / 2 });
  }, []);

  // --- Initial load: draw the original image + the auto mask at native resolution, seed history. ---
  useEffect(() => {
    let cancelled = false;
    async function setup() {
      setLoadState('loading');
      try {
        const img = await loadImage(imagePreviewUrl);
        if (cancelled) return;

        const imageCanvas = imageCanvasRef.current!;
        imageCanvas.width = autoMask.originalWidth;
        imageCanvas.height = autoMask.originalHeight;
        imageCanvas.getContext('2d')!.drawImage(img, 0, 0, autoMask.originalWidth, autoMask.originalHeight);

        const raw = document.createElement('canvas');
        raw.width = autoMask.originalWidth;
        raw.height = autoMask.originalHeight;
        await paintDataUrlOntoCanvas(raw, autoMask.maskDataUrl);
        if (cancelled) return;
        maskCanvasRef.current = raw;

        const overlay = overlayCanvasRef.current!;
        const cov = deriveOverlayFromMask(raw, overlay);
        if (cancelled) return;
        setCoverage(cov);

        historyRef.current = [canvasToDataUrl(raw)];
        historyIndexRef.current = 0;
        setCanUndo(false);
        setCanRedo(false);

        setLoadState('ready');
        requestAnimationFrame(() => fitToScreen());
      } catch {
        if (!cancelled) setLoadState('error');
      }
    }
    void setup();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagePreviewUrl, autoMask]);

  useEffect(() => {
    if (!isSubmitting) submittingGuardRef.current = false;
  }, [isSubmitting]);

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  function setZoomAtPoint(pointX: number, pointY: number, nextZoomRaw: number) {
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoomRaw));
    const currentZoom = zoomRef.current;
    const currentPan = panRef.current;
    const imageX = (pointX - currentPan.x) / currentZoom;
    const imageY = (pointY - currentPan.y) / currentZoom;
    setPan({ x: pointX - imageX * nextZoom, y: pointY - imageY * nextZoom });
    setZoom(nextZoom);
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    setZoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, zoomRef.current * factor);
  }

  function zoomByButton(factor: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    setZoomAtPoint(rect.width / 2, rect.height / 2, zoomRef.current * factor);
  }

  async function toggleFullscreen() {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Fullscreen is best-effort ("tela cheia, se possível") — some hosts
      // (embedded iframes, permissions policy) block it; fail silently.
    }
  }

  function getImagePoint(e: React.PointerEvent): { x: number; y: number } | null {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    const containerX = e.clientX - rect.left;
    const containerY = e.clientY - rect.top;
    return { x: (containerX - panRef.current.x) / zoomRef.current, y: (containerY - panRef.current.y) / zoomRef.current };
  }

  function paintDab(x: number, y: number) {
    const raw = maskCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!raw || !overlay) return;
    const radius = brushSizeRef.current / 2;
    const currentTool = toolRef.current;

    const rawCtx = raw.getContext('2d')!;
    rawCtx.fillStyle = currentTool === 'protect' ? '#000000' : '#ffffff';
    rawCtx.beginPath();
    rawCtx.arc(x, y, radius, 0, Math.PI * 2);
    rawCtx.fill();

    const overlayCtx = overlay.getContext('2d')!;
    overlayCtx.globalCompositeOperation = currentTool === 'protect' ? 'source-over' : 'destination-out';
    overlayCtx.fillStyle = currentTool === 'protect' ? `rgba(${OVERLAY_COLOR}, 1)` : 'rgba(0,0,0,1)';
    overlayCtx.beginPath();
    overlayCtx.arc(x, y, radius, 0, Math.PI * 2);
    overlayCtx.fill();
    overlayCtx.globalCompositeOperation = 'source-over';
  }

  function paintStroke(fromX: number, fromY: number, toX: number, toY: number) {
    const raw = maskCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!raw || !overlay) return;
    const currentTool = toolRef.current;
    const width = brushSizeRef.current;

    const rawCtx = raw.getContext('2d')!;
    rawCtx.lineCap = 'round';
    rawCtx.lineJoin = 'round';
    rawCtx.lineWidth = width;
    rawCtx.strokeStyle = currentTool === 'protect' ? '#000000' : '#ffffff';
    rawCtx.beginPath();
    rawCtx.moveTo(fromX, fromY);
    rawCtx.lineTo(toX, toY);
    rawCtx.stroke();

    const overlayCtx = overlay.getContext('2d')!;
    overlayCtx.lineCap = 'round';
    overlayCtx.lineJoin = 'round';
    overlayCtx.lineWidth = width;
    overlayCtx.globalCompositeOperation = currentTool === 'protect' ? 'source-over' : 'destination-out';
    overlayCtx.strokeStyle = currentTool === 'protect' ? `rgba(${OVERLAY_COLOR}, 1)` : 'rgba(0,0,0,1)';
    overlayCtx.beginPath();
    overlayCtx.moveTo(fromX, fromY);
    overlayCtx.lineTo(toX, toY);
    overlayCtx.stroke();
    overlayCtx.globalCompositeOperation = 'source-over';
  }

  function commitHistorySnapshot() {
    const raw = maskCanvasRef.current;
    if (!raw) return;
    const snapshot = canvasToDataUrl(raw);
    const truncated = historyRef.current.slice(0, historyIndexRef.current + 1);
    truncated.push(snapshot);
    while (truncated.length > MAX_HISTORY) truncated.shift();
    historyRef.current = truncated;
    historyIndexRef.current = truncated.length - 1;
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(false);
  }

  const restoreFromHistory = useCallback(async (index: number) => {
    const raw = maskCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    const dataUrl = historyRef.current[index];
    if (!raw || !overlay || !dataUrl) return;
    await paintDataUrlOntoCanvas(raw, dataUrl);
    const cov = deriveOverlayFromMask(raw, overlay);
    setCoverage(cov);
  }, []);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    void restoreFromHistory(historyIndexRef.current).then(() => {
      setCanUndo(historyIndexRef.current > 0);
      setCanRedo(true);
    });
  }, [restoreFromHistory]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    void restoreFromHistory(historyIndexRef.current).then(() => {
      setCanUndo(true);
      setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
    });
  }, [restoreFromHistory]);

  const undoRedoRef = useRef({ undo, redo });
  undoRedoRef.current = { undo, redo };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && e.shiftKey) {
        e.preventDefault();
        undoRedoRef.current.redo();
      } else if (key === 'z') {
        e.preventDefault();
        undoRedoRef.current.undo();
      } else if (key === 'y') {
        e.preventDefault();
        undoRedoRef.current.redo();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  async function handleRestoreAutoMask() {
    const raw = maskCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!raw || !overlay) return;
    await paintDataUrlOntoCanvas(raw, autoMask.maskDataUrl);
    const cov = deriveOverlayFromMask(raw, overlay);
    setCoverage(cov);
    commitHistorySnapshot();
  }

  function updateCursorPreview(e: React.PointerEvent) {
    const el = cursorPreviewRef.current;
    const viewport = viewportRef.current;
    if (!el || !viewport) return;
    if (toolRef.current === 'pan') {
      el.style.display = 'none';
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const size = Math.max(4, brushSizeRef.current * zoomRef.current);
    el.style.display = 'block';
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px)`;
    el.style.borderColor = toolRef.current === 'protect' ? 'rgb(37, 99, 235)' : 'rgb(220, 38, 38)';
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (loadState !== 'ready') return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (toolRef.current === 'pan') {
      panStartRef.current = { clientX: e.clientX, clientY: e.clientY, panX: panRef.current.x, panY: panRef.current.y };
      return;
    }
    const pt = getImagePoint(e);
    if (!pt) return;
    isDrawingRef.current = true;
    lastPointRef.current = pt;
    paintDab(pt.x, pt.y);
  }

  function handlePointerMove(e: React.PointerEvent) {
    updateCursorPreview(e);
    if (toolRef.current === 'pan') {
      const start = panStartRef.current;
      if (!start) return;
      setPan({ x: start.panX + (e.clientX - start.clientX), y: start.panY + (e.clientY - start.clientY) });
      return;
    }
    if (!isDrawingRef.current) return;
    const pt = getImagePoint(e);
    const last = lastPointRef.current;
    if (!pt || !last) return;
    paintStroke(last.x, last.y, pt.x, pt.y);
    lastPointRef.current = pt;
  }

  function handlePointerUp() {
    if (toolRef.current === 'pan') {
      panStartRef.current = null;
      return;
    }
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    lastPointRef.current = null;
    commitHistorySnapshot();
    const raw = maskCanvasRef.current;
    if (raw) setCoverage(computeMaskCoverage(raw));
  }

  function handlePointerLeaveViewport() {
    if (cursorPreviewRef.current) cursorPreviewRef.current.style.display = 'none';
  }

  function handleConfirmClick() {
    if (isSubmitting || submittingGuardRef.current) return;
    if (!confirmChecked || !dimensionsMatch) return;
    const raw = maskCanvasRef.current;
    if (!raw) return;
    submittingGuardRef.current = true;
    void canvasToPngBlob(raw).then((blob) => onConfirm(blob));
  }

  const maskReady = loadState === 'ready' && maskCanvasRef.current !== null;
  const dimensionsMatch = maskReady && maskCanvasRef.current!.width === autoMask.originalWidth && maskCanvasRef.current!.height === autoMask.originalHeight;
  const canAfford = walletBalance >= costCredits;
  const canGenerate = maskReady && dimensionsMatch && confirmChecked && canAfford && !isSubmitting;

  const toolButtonClass = (active: boolean) =>
    `flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
      active ? 'bg-sapphire text-white' : 'bg-surface-secondary text-ink-secondary hover:text-ink'
    }`;

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col overflow-hidden bg-surface-secondary">
      <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-2.5">
        <h2 className="text-sm font-semibold text-ink">{t.title}</h2>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-secondary transition hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t.cancelButton}
        </button>
      </div>

      {rejection && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-danger">{t.rejectedTitle}</p>
          <p className="mt-0.5 text-sm text-ink-secondary">{rejection.reason}</p>
          <p className="mt-1 text-xs text-ink-muted">{t.rejectedHint}</p>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div
          ref={viewportRef}
          className="relative flex-1 overflow-hidden"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerLeaveViewport}
          style={{ cursor: tool === 'pan' ? 'grab' : 'none', touchAction: 'none' }}
        >
          {loadState === 'loading' && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-surface-secondary">
              <p className="text-sm text-ink-secondary">{t.loadingMask}</p>
            </div>
          )}
          {loadState === 'error' && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-surface-secondary">
              <p className="text-sm text-danger">{t.loadingMaskFailed}</p>
            </div>
          )}

          <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-border bg-surface/95 p-1 shadow-card">
            <button type="button" onClick={() => zoomByButton(1 / ZOOM_STEP)} className="rounded-md p-1.5 text-ink-secondary hover:bg-surface-secondary" title={t.zoomOut}>
              <ZoomOut size={16} />
            </button>
            <span className="w-12 text-center text-xs font-mono text-ink-secondary">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => zoomByButton(ZOOM_STEP)} className="rounded-md p-1.5 text-ink-secondary hover:bg-surface-secondary" title={t.zoomIn}>
              <ZoomIn size={16} />
            </button>
            <div className="mx-1 h-5 w-px bg-border" />
            <button type="button" onClick={fitToScreen} className="rounded-md px-2 py-1.5 text-xs font-medium text-ink-secondary hover:bg-surface-secondary" title={t.fitToScreen}>
              {t.fitToScreen}
            </button>
            <button type="button" onClick={toggleFullscreen} className="rounded-md p-1.5 text-ink-secondary hover:bg-surface-secondary" title={isFullscreen ? t.exitFullscreen : t.fullscreen}>
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>

          <div className="absolute right-3 top-3 z-10 rounded-lg border border-border bg-surface/95 p-3 text-xs shadow-card">
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: `rgba(${OVERLAY_COLOR}, 0.8)` }} />
              <span className="text-ink-secondary">{t.legendProtected}</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm border border-border" />
              <span className="text-ink-secondary">{t.legendEditable}</span>
            </div>
            <div className="mt-2 border-t border-border pt-2 font-mono text-ink">
              {t.protectedPercent(Math.round(coverage.protectedPercent))} · {t.editablePercent(Math.round(coverage.editablePercent))}
            </div>
          </div>

          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            <canvas ref={imageCanvasRef} className="block" />
            <canvas ref={overlayCanvasRef} className="absolute left-0 top-0 block" style={{ opacity: overlayOpacity }} />
          </div>

          <div
            ref={cursorPreviewRef}
            className="pointer-events-none absolute left-0 top-0 z-20 hidden rounded-full border-2 bg-transparent"
            style={{ display: 'none' }}
          />
        </div>

        <div className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface p-4">
          <div className="flex flex-col gap-1.5">
            <button type="button" onClick={() => setTool('protect')} className={toolButtonClass(tool === 'protect')}>
              <Paintbrush size={15} />
              {t.toolProtect}
            </button>
            <button type="button" onClick={() => setTool('allow')} className={toolButtonClass(tool === 'allow')}>
              <Eraser size={15} />
              {t.toolAllow}
            </button>
            <button type="button" onClick={() => setTool('pan')} className={toolButtonClass(tool === 'pan')}>
              <Hand size={15} />
              {t.toolPan}
            </button>
          </div>

          <div className="mt-4">
            <label className="text-xs font-medium text-ink-secondary">{t.brushSizeLabel}</label>
            <input
              type="range"
              min={MIN_BRUSH}
              max={MAX_BRUSH}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="mt-1 w-full"
            />
          </div>

          <div className="mt-3">
            <label className="text-xs font-medium text-ink-secondary">{t.opacityLabel}</label>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={overlayOpacity}
              onChange={(e) => setOverlayOpacity(Number(e.target.value))}
              className="mt-1 w-full"
            />
          </div>

          <div className="mt-4 flex gap-1.5">
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-surface-secondary px-2 py-2 text-xs font-medium text-ink-secondary transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              title={t.undo}
            >
              <Undo2 size={14} />
              {t.undo}
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-surface-secondary px-2 py-2 text-xs font-medium text-ink-secondary transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              title={t.redo}
            >
              <Redo2 size={14} />
              {t.redo}
            </button>
          </div>

          <button
            type="button"
            onClick={handleRestoreAutoMask}
            disabled={!maskReady}
            className="mt-2 flex items-center justify-center gap-1.5 rounded-lg border border-border px-2 py-2 text-xs font-medium text-ink-secondary transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            title={t.clearManualEdits}
          >
            <RotateCcw size={14} />
            {t.restoreAutoMask}
          </button>

          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            {t.coverageWarning}
          </div>

          <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
            <label className="flex items-start gap-2 text-xs text-ink-secondary">
              <input
                type="checkbox"
                checked={confirmChecked}
                onChange={(e) => setConfirmChecked(e.target.checked)}
                disabled={!maskReady || isSubmitting}
                className="mt-0.5"
              />
              <span>{t.confirmCheckboxLabel(costCredits)}</span>
            </label>

            <p className="text-xs text-ink-muted">{t.balanceLabel(walletBalance)}</p>

            {!canAfford && <p className="text-xs text-danger">{messages.wallet.insufficientMessage(costCredits, walletBalance)}</p>}
            {!dimensionsMatch && maskReady && <p className="text-xs text-danger">{t.dimensionMismatch}</p>}

            <button
              type="button"
              onClick={handleConfirmClick}
              disabled={!canGenerate}
              className="w-full rounded-xl bg-sapphire py-3 text-sm font-semibold text-white shadow-glow transition hover:bg-sapphire-hover disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:text-ink-muted disabled:shadow-none"
            >
              {isSubmitting ? t.confirmButtonSubmitting : t.confirmButton}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
