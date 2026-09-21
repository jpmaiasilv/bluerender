import { RefObject, useRef, useState } from 'react';
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva';
import Konva from 'konva';
import {
  EditorElement,
  EditorToolMode,
  RoomNameElement,
  RoomNumberElement,
  ScaleBarElement,
  TextElement,
} from '../../lib/plantaEditor/types';
import { useLanguage } from '../../i18n';

interface Props {
  image: HTMLImageElement;
  width: number;
  height: number;
  elements: EditorElement[];
  /** `commit=true` (the default the parent should treat any omitted call as) pushes an undo checkpoint; `commit=false` mutates without one — used only for the intermediate points of an in-progress freehand stroke, so the whole stroke undoes as a single step instead of one step per pixel of mouse movement. */
  onElementsChange: (elements: EditorElement[], commit?: boolean) => void;
  tool: EditorToolMode;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  brushSize: number;
  brushOpacity: number;
  scaleBarMeters: number;
  stageRef: RefObject<Konva.Stage>;
}

interface PendingTextEdit {
  id: string | null;
  x: number;
  y: number;
  value: string;
  type: 'text' | 'roomName';
}

const MASK_COLOR = '#22C55E';
const DRAW_COLOR = '#1258C7';

/**
 * The Stage always contains: a white background Rect (so JPG export never
 * shows black where the image doesn't cover), the loaded floor plan image,
 * then one Layer per every placed element — exporting the Stage therefore
 * always flattens image + every annotation into one raster, satisfying
 * "export includes every annotation" with no extra bookkeeping.
 *
 * Text input is intentionally NOT an inline overlay positioned exactly over
 * the click point (that requires re-deriving screen coordinates through the
 * stage's current pan offset, which is easy to get subtly wrong) — instead
 * clicking with the text/roomName tool opens a small fixed-position popup;
 * the element's real canvas position was already captured at click time, so
 * placement is exact regardless of where the popup itself renders.
 */
export function EditorCanvas({
  image,
  width,
  height,
  elements,
  onElementsChange,
  tool,
  selectedId,
  onSelect,
  brushSize,
  brushOpacity,
  scaleBarMeters,
  stageRef,
}: Props) {
  const t = useLanguage().messages.plantaEditor;
  const isDrawing = useRef(false);
  const currentStrokeId = useRef<string | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingTextEdit | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const shapeRefs = useRef<Record<string, Konva.Node>>({});

  function updateElement(id: string, patch: Partial<EditorElement>) {
    onElementsChange(elements.map((el) => (el.id === id ? ({ ...el, ...patch } as EditorElement) : el)));
  }

  function attachTransformer(id: string | null) {
    const tr = transformerRef.current;
    if (!tr) return;
    if (!id) {
      tr.nodes([]);
      return;
    }
    const node = shapeRefs.current[id];
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }

  function handleStageMouseDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    const stage = e.target.getStage();
    if (!stage) return;
    const pos = stage.getRelativePointerPosition();
    if (!pos) return;

    // Clicking empty canvas area clears selection, regardless of tool.
    if (e.target === stage) onSelect(null);

    if (tool === 'draw' || tool === 'maskBrush') {
      isDrawing.current = true;
      const id = crypto.randomUUID();
      currentStrokeId.current = id;
      const newEl: EditorElement =
        tool === 'draw'
          ? { id, type: 'draw', points: [pos.x, pos.y], color: DRAW_COLOR, strokeWidth: brushSize }
          : { id, type: 'maskStroke', points: [pos.x, pos.y], strokeWidth: brushSize, opacity: brushOpacity };
      onElementsChange([...elements, newEl]);
      return;
    }

    if (tool === 'text' || tool === 'roomName') {
      setPendingEdit({ id: null, x: pos.x, y: pos.y, value: '', type: tool });
      return;
    }

    if (tool === 'roomNumber') {
      const nextNumber = elements.filter((el) => el.type === 'roomNumber').length + 1;
      const newEl: RoomNumberElement = { id: crypto.randomUUID(), type: 'roomNumber', x: pos.x, y: pos.y, number: nextNumber };
      onElementsChange([...elements, newEl]);
      return;
    }

    if (tool === 'scaleBar') {
      const newEl: ScaleBarElement = {
        id: crypto.randomUUID(),
        type: 'scaleBar',
        x: pos.x,
        y: pos.y,
        realMeters: scaleBarMeters,
        pixelLength: 150,
      };
      onElementsChange([...elements, newEl]);
    }
  }

  function handleStageMouseMove(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!isDrawing.current || !currentStrokeId.current) return;
    const stage = e.target.getStage();
    const pos = stage?.getRelativePointerPosition();
    if (!pos) return;
    const id = currentStrokeId.current;
    onElementsChange(
      elements.map((el) => ((el.type === 'draw' || el.type === 'maskStroke') && el.id === id ? { ...el, points: [...el.points, pos.x, pos.y] } : el)),
      false
    );
  }

  function handleStageMouseUp() {
    isDrawing.current = false;
    currentStrokeId.current = null;
  }

  function commitPendingEdit() {
    if (!pendingEdit) return;
    const value = pendingEdit.value.trim();
    if (pendingEdit.id) {
      // Editing an existing element — an emptied text deletes it instead of leaving a blank label.
      if (!value) {
        onElementsChange(elements.filter((el) => el.id !== pendingEdit.id));
      } else {
        updateElement(pendingEdit.id, { text: value } as Partial<TextElement | RoomNameElement>);
      }
    } else if (value) {
      const newEl: TextElement | RoomNameElement =
        pendingEdit.type === 'text'
          ? { id: crypto.randomUUID(), type: 'text', x: pendingEdit.x, y: pendingEdit.y, text: value, fontSize: 16, rotation: 0 }
          : { id: crypto.randomUUID(), type: 'roomName', x: pendingEdit.x, y: pendingEdit.y, text: value, rotation: 0 };
      onElementsChange([...elements, newEl]);
    }
    setPendingEdit(null);
  }

  const selectable = tool === 'select';

  return (
    <div className="relative inline-block">
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        draggable={tool === 'move'}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onTouchStart={handleStageMouseDown}
        onTouchMove={handleStageMouseMove}
        onTouchEnd={handleStageMouseUp}
        className="rounded-xl border border-border bg-white"
      >
        <Layer>
          <Rect x={0} y={0} width={width} height={height} fill="#ffffff" />
          <KonvaImage image={image} width={width} height={height} listening={false} />
        </Layer>

        <Layer>
          {elements.map((el) => {
            if (el.type === 'draw' || el.type === 'maskStroke') {
              return (
                <Line
                  key={el.id}
                  ref={(node) => {
                    if (node) shapeRefs.current[el.id] = node;
                  }}
                  points={el.points}
                  stroke={el.type === 'draw' ? el.color : MASK_COLOR}
                  strokeWidth={el.strokeWidth}
                  opacity={el.type === 'maskStroke' ? el.opacity : 1}
                  lineCap="round"
                  lineJoin="round"
                  draggable={selectable}
                  onClick={() => selectable && onSelect(el.id)}
                  onTap={() => selectable && onSelect(el.id)}
                  onDragEnd={(e) => {
                    // Konva.Line dragging moves via its own x/y transform, not the points array —
                    // baking that offset back into the points keeps our own model authoritative.
                    const node = e.target;
                    const dx = node.x();
                    const dy = node.y();
                    node.position({ x: 0, y: 0 });
                    updateElement(el.id, { points: el.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)) } as Partial<EditorElement>);
                  }}
                />
              );
            }

            if (el.type === 'roomNumber') {
              return (
                <Group
                  key={el.id}
                  ref={(node) => {
                    if (node) shapeRefs.current[el.id] = node;
                  }}
                  x={el.x}
                  y={el.y}
                  draggable={selectable}
                  onClick={() => selectable && onSelect(el.id)}
                  onTap={() => selectable && onSelect(el.id)}
                  onDragEnd={(e) => updateElement(el.id, { x: e.target.x(), y: e.target.y() } as Partial<RoomNumberElement>)}
                >
                  <Circle radius={14} fill="#1258C7" stroke="#ffffff" strokeWidth={2} />
                  <Text text={String(el.number)} fontSize={13} fontStyle="bold" fill="#ffffff" width={28} height={28} offsetX={14} offsetY={14} align="center" verticalAlign="middle" />
                </Group>
              );
            }

            if (el.type === 'roomName' || el.type === 'text') {
              return (
                <Text
                  key={el.id}
                  ref={(node) => {
                    if (node) shapeRefs.current[el.id] = node;
                  }}
                  x={el.x}
                  y={el.y}
                  text={el.text}
                  fontSize={el.type === 'roomName' ? 14 : (el as TextElement).fontSize}
                  fontStyle={el.type === 'roomName' ? 'bold' : 'normal'}
                  fill="#111827"
                  rotation={el.rotation}
                  padding={4}
                  draggable={selectable}
                  onClick={() => selectable && onSelect(el.id)}
                  onTap={() => selectable && onSelect(el.id)}
                  onDblClick={() => setPendingEdit({ id: el.id, x: el.x, y: el.y, value: el.text, type: el.type })}
                  onDblTap={() => setPendingEdit({ id: el.id, x: el.x, y: el.y, value: el.text, type: el.type })}
                  onDragEnd={(e) => updateElement(el.id, { x: e.target.x(), y: e.target.y() } as Partial<TextElement | RoomNameElement>)}
                  onTransformEnd={(e) => {
                    const node = e.target;
                    updateElement(el.id, { rotation: node.rotation() } as Partial<TextElement | RoomNameElement>);
                  }}
                />
              );
            }

            // scaleBar
            const bar = el as ScaleBarElement;
            const tick = 8;
            return (
              <Group
                key={el.id}
                ref={(node) => {
                  if (node) shapeRefs.current[el.id] = node;
                }}
                x={bar.x}
                y={bar.y}
                draggable={selectable}
                onClick={() => selectable && onSelect(el.id)}
                onTap={() => selectable && onSelect(el.id)}
                onDragEnd={(e) => updateElement(el.id, { x: e.target.x(), y: e.target.y() } as Partial<ScaleBarElement>)}
              >
                <Line points={[0, 0, bar.pixelLength, 0]} stroke="#111827" strokeWidth={2} />
                <Line points={[0, -tick, 0, tick]} stroke="#111827" strokeWidth={2} />
                <Line points={[bar.pixelLength, -tick, bar.pixelLength, tick]} stroke="#111827" strokeWidth={2} />
                <Text text={`${bar.realMeters} m`} x={0} y={tick + 4} width={bar.pixelLength} align="center" fontSize={12} fill="#111827" />
              </Group>
            );
          })}

          {selectedId && (tool === 'select' || tool === 'move') && (
            <Transformer
              ref={(node) => {
                transformerRef.current = node;
                if (node) attachTransformer(selectedId);
              }}
              rotateEnabled
              enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
              boundBoxFunc={(oldBox, newBox) => (newBox.width < 10 || newBox.height < 10 ? oldBox : newBox)}
            />
          )}
        </Layer>
      </Stage>

      {pendingEdit && (
        <div className="absolute left-1/2 top-3 z-10 w-72 -translate-x-1/2 rounded-xl border border-border bg-surface p-3 shadow-card">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-secondary">
            {pendingEdit.type === 'roomName' ? t.plantaTools.roomName : t.editMenu.addManualCaption}
          </p>
          <input
            autoFocus
            type="text"
            value={pendingEdit.value}
            onChange={(e) => setPendingEdit({ ...pendingEdit, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitPendingEdit();
              if (e.key === 'Escape') setPendingEdit(null);
            }}
            placeholder={t.emptyStateHint}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-sapphire focus:ring-1 focus:ring-sapphire"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setPendingEdit(null)} className="rounded-md px-2.5 py-1 text-xs text-ink-secondary hover:bg-surface-secondary">
              {t.cancel}
            </button>
            <button type="button" onClick={commitPendingEdit} className="rounded-md bg-sapphire px-2.5 py-1 text-xs font-medium text-white hover:bg-sapphire-hover">
              {t.confirm}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
