import { useEffect, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, ClipboardPaste, UploadCloud } from 'lucide-react';
import Konva from 'konva';
import { EditorCanvas } from '../components/planta-editor/EditorCanvas';
import { EditorToolbar } from '../components/planta-editor/EditorToolbar';
import { EditMenu } from '../components/planta-editor/EditMenu';
import { PlantaToolsPanel } from '../components/planta-editor/PlantaToolsPanel';
import { EditorElement, EditorToolMode } from '../lib/plantaEditor/types';
import { loadEditorState, saveEditorState } from '../lib/plantaEditor/storage';
import { exportStageJpg, exportStagePdf, exportStagePng } from '../lib/plantaEditor/exportCanvas';
import { useHtmlImage } from '../lib/plantaEditor/useHtmlImage';
import { useLanguage } from '../i18n';

const MAX_CANVAS_WIDTH = 1100;

/**
 * Tela 2 (Editar) — MVP scope: canvas + every tool that does NOT require an
 * AI model (numbering rooms, room-name labels, a graphic scale bar, free
 * annotation, a mask brush for later AI tools to consume, undo/redo, and
 * PNG/JPG/PDF export). The AI-dependent items from the original spec (remove
 * object, extend image, add people, swap material, change time of day,
 * change flooring, add shadow, automatic captions) are listed in the Editar
 * menu but disabled — see EditMenu.tsx.
 *
 * Opened from Planta Humanizada's persistent "Editar" header link, either as
 * `?src=<imageUrl>&requestId=<id>` (a result from this session) or with no
 * params at all — the editor accepts pasting (Ctrl+V) or uploading any image
 * directly, so it's never gated on having just generated something.
 */
export function PlantaEditorPage() {
  const { messages } = useLanguage();
  const t = messages.plantaEditor;
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get('requestId');

  // `loadedSrc` starts from the URL but can also be filled in later by
  // pasting/uploading — once that happens there's no server-side requestId
  // to key saved annotations by, so a fresh client-side id is used instead
  // (stable for the rest of this session/tab).
  const [loadedSrc, setLoadedSrc] = useState<string | null>(searchParams.get('src'));
  const [sessionId] = useState(() => requestId ?? crypto.randomUUID());
  const pastedUrlRef = useRef<string | null>(null);

  const image = useHtmlImage(loadedSrc);
  const stageRef = useRef<Konva.Stage>(null);

  const [elements, setElements] = useState<EditorElement[]>([]);
  const [history, setHistory] = useState<EditorElement[][]>([]);
  const [future, setFuture] = useState<EditorElement[][]>([]);
  const [tool, setTool] = useState<EditorToolMode>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scaleBarMeters, setScaleBarMeters] = useState(1);
  const [brushSize, setBrushSize] = useState(24);
  const [brushOpacity, setBrushOpacity] = useState(0.5);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    const saved = loadEditorState(sessionId);
    if (saved) setElements(saved);
    // Only ever restore once, for whichever id this tab started with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Revokes the object URL created for a pasted/uploaded image when it's
  // replaced or the page unmounts — the URL from a server-side `src` (a
  // plain /results/... path) is never one of these, so it's left alone.
  useEffect(() => {
    return () => {
      if (pastedUrlRef.current) URL.revokeObjectURL(pastedUrlRef.current);
    };
  }, []);

  function loadImageFromBlob(blob: Blob) {
    if (pastedUrlRef.current) URL.revokeObjectURL(pastedUrlRef.current);
    const url = URL.createObjectURL(blob);
    pastedUrlRef.current = url;
    setLoadedSrc(url);
  }

  useEffect(() => {
    if (loadedSrc) return;
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) loadImageFromBlob(blob);
          return;
        }
      }
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [loadedSrc]);

  // Deliberately not memoized with useCallback: it needs the current
  // `elements` from this render's closure (to snapshot it into `history`
  // before switching to `next`), and EditorCanvas isn't memoized, so there's
  // no benefit to memoizing this — only the risk of it capturing a stale
  // `elements` value.
  function handleElementsChange(next: EditorElement[], commit = true) {
    if (commit) {
      setHistory((h) => [...h, elements]);
      setFuture([]);
    }
    setElements(next);
  }

  function handleErase() {
    if (!selectedId) return;
    setHistory((h) => [...h, elements]);
    setFuture([]);
    setElements((prev) => prev.filter((el) => el.id !== selectedId));
    setSelectedId(null);
  }

  function handleCopy() {
    if (!selectedId) return;
    const source = elements.find((el) => el.id === selectedId);
    if (!source) return;
    const offset = 16;
    const copy: EditorElement =
      'x' in source ? { ...source, id: crypto.randomUUID(), x: source.x + offset, y: source.y + offset } : { ...source, id: crypto.randomUUID() };
    setHistory((h) => [...h, elements]);
    setFuture([]);
    setElements((prev) => [...prev, copy]);
    setSelectedId(copy.id);
  }

  function handleUndo() {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setFuture((f) => [elements, ...f]);
    setElements(prev);
    setSelectedId(null);
  }

  function handleRedo() {
    if (future.length === 0) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setHistory((h) => [...h, elements]);
    setElements(next);
    setSelectedId(null);
  }

  function handleSave() {
    saveEditorState(sessionId, elements);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1500);
  }

  function withStage(fn: (stage: Konva.Stage) => void) {
    const stage = stageRef.current;
    if (stage) fn(stage);
  }

  const canvasWidth = image ? Math.min(image.naturalWidth, MAX_CANVAS_WIDTH) : 0;
  const canvasHeight = image ? (canvasWidth / image.naturalWidth) * image.naturalHeight : 0;

  if (!loadedSrc) {
    return (
      <div className="flex h-full flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
          <Link to="/planta-humanizada" className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium text-ink-secondary transition hover:bg-surface-secondary" title={t.backToPlanta}>
            <ArrowLeft size={16} />
          </Link>
          <h1 className="text-sm font-semibold text-ink">{t.title}</h1>
        </div>
        <div className="flex flex-1 items-center justify-center p-8">
          <label className="flex w-full max-w-md cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border bg-surface-secondary/60 px-8 py-12 text-center transition hover:border-sapphire/50">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sapphire-light text-sapphire">
              <UploadCloud size={22} />
            </div>
            <p className="text-sm font-medium text-ink">{t.pasteOrUploadHint}</p>
            <p className="flex items-center gap-1.5 text-xs text-ink-muted">
              <ClipboardPaste size={13} />
              Ctrl+V
            </p>
            <input
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) loadImageFromBlob(file);
              }}
            />
          </label>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <EditorToolbar
        tool={tool}
        onToolChange={setTool}
        hasSelection={Boolean(selectedId)}
        onErase={handleErase}
        onCopy={handleCopy}
        onSave={handleSave}
        justSaved={justSaved}
        canUndo={history.length > 0}
        canRedo={future.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onExportPng={() => withStage((s) => exportStagePng(s, 'planta-humanizada.png'))}
        onExportJpg={() => withStage((s) => exportStageJpg(s, 'planta-humanizada.jpg'))}
        onExportPdf={() => withStage((s) => exportStagePdf(s, 'planta-humanizada.pdf'))}
      />

      <div className="flex items-center gap-2 border-b border-border bg-surface-secondary/60 px-4 py-2">
        <EditMenu tool={tool} onToolChange={setTool} />
        <p className="text-xs text-ink-muted">{t.emptyStateHint}</p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 items-start justify-center overflow-auto bg-surface-secondary/40 p-6">
          {image ? (
            <EditorCanvas
              image={image}
              width={canvasWidth}
              height={canvasHeight}
              elements={elements}
              onElementsChange={handleElementsChange}
              tool={tool}
              selectedId={selectedId}
              onSelect={setSelectedId}
              brushSize={brushSize}
              brushOpacity={brushOpacity}
              scaleBarMeters={scaleBarMeters}
              stageRef={stageRef}
            />
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-ink-muted">…</div>
          )}
        </div>

        <PlantaToolsPanel
          tool={tool}
          onToolChange={setTool}
          scaleBarMeters={scaleBarMeters}
          onScaleBarMetersChange={setScaleBarMeters}
          brushSize={brushSize}
          onBrushSizeChange={setBrushSize}
          brushOpacity={brushOpacity}
          onBrushOpacityChange={setBrushOpacity}
        />
      </div>
    </div>
  );
}
