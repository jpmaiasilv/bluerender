/**
 * Planta Humanizada's editor (Tela 2) — MVP scope: manual/canvas-only tools,
 * nothing that calls an AI model. Every element the user places lives in this
 * one array so a single Konva Stage (image + all elements) can be exported as
 * one flattened PNG/JPG/PDF, and so undo/redo is just snapshotting this array.
 */

export type EditorToolMode =
  | 'select'
  | 'move'
  | 'draw'
  | 'text'
  | 'roomNumber'
  | 'roomName'
  | 'scaleBar'
  | 'maskBrush';

interface BaseElement {
  id: string;
}

export interface FreeDrawElement extends BaseElement {
  type: 'draw';
  points: number[];
  color: string;
  strokeWidth: number;
}

export interface TextElement extends BaseElement {
  type: 'text';
  x: number;
  y: number;
  text: string;
  fontSize: number;
  rotation: number;
}

export interface RoomNumberElement extends BaseElement {
  type: 'roomNumber';
  x: number;
  y: number;
  number: number;
}

export interface RoomNameElement extends BaseElement {
  type: 'roomName';
  x: number;
  y: number;
  text: string;
  rotation: number;
}

export interface ScaleBarElement extends BaseElement {
  type: 'scaleBar';
  x: number;
  y: number;
  /** Real-world distance this bar represents, in meters (e.g. 1 or 5) — shown as its label. */
  realMeters: number;
  /** On-screen length of the bar in canvas pixels — the user drags/resizes this to calibrate against the plan's own scale. */
  pixelLength: number;
}

/** A brush stroke marking an area for a future AI edit (object removal, material swap, etc.) — purely a manual marking tool in this MVP; no AI action consumes it yet. */
export interface MaskStrokeElement extends BaseElement {
  type: 'maskStroke';
  points: number[];
  strokeWidth: number;
  opacity: number;
}

export type EditorElement =
  | FreeDrawElement
  | TextElement
  | RoomNumberElement
  | RoomNameElement
  | ScaleBarElement
  | MaskStrokeElement;

/** Elements with a single (x, y) anchor that can be selected/dragged as a point — everything except freehand strokes (draw/maskBrush), which are selected as a whole polyline instead. */
export function isPointElement(el: EditorElement): el is TextElement | RoomNumberElement | RoomNameElement | ScaleBarElement {
  return el.type === 'text' || el.type === 'roomNumber' || el.type === 'roomName' || el.type === 'scaleBar';
}
