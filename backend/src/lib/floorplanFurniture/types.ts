/**
 * Shared types for the Gemini semantic furniture/room-recognition pipeline.
 * Read-only analysis only — nothing here ever touches FLUX.1 Fill, the
 * credit wallet, or generation jobs (see providers/geminiVision.ts and
 * scripts/inspect-gemini-furniture.ts for the enforced boundaries).
 */

/** Axis-aligned rectangle in ORIGINAL image pixel coordinates (never normalized, never in a crop's local space) unless a type name says otherwise. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Point = [number, number];

/** [ymin, xmin, ymax, xmax] — matches Gemini's own box_2d axis order, kept consistent end-to-end instead of silently transposing to [xmin,ymin,xmax,ymax] partway through the pipeline. */
export type Box = [number, number, number, number];

export const FURNITURE_CATEGORIES = [
  'comodo',
  'cama',
  'sofa',
  'mesa',
  'cadeira',
  'armario',
  'bancada',
  'pia',
  'vaso_sanitario',
  'chuveiro',
  'eletrodomestico',
  'escada',
  'veiculo',
  'mobiliario_outro',
  'objeto_outro',
] as const;

export type FurnitureCategory = (typeof FURNITURE_CATEGORIES)[number];

/** One object exactly as Gemini returned it for a single crop/tile — coordinates still normalized 0-1000 relative to THAT crop, not yet mapped back to the original image. Validated against GeminiDetectionSchema (see geminiResponseSchema.ts) before this type is ever trusted. */
export interface RawGeminiDetection {
  category: FurnitureCategory;
  label: string;
  roomType: string | null;
  confidence: number;
  box_2d: Box;
  mask: Point[] | null;
}

/** A crop/tile sent to Gemini, and the transform needed to map its local 0-1000-normalized coordinates back to the original image. */
export interface SourceCrop {
  /** 'overview' | 'tile-<n>' — purely a label for artifacts/logging. */
  id: string;
  /** Where this crop sits in the ORIGINAL image. */
  rectInOriginal: PixelRect;
  /** The crop's own pixel dimensions AFTER any resize applied before sending to Gemini (what Gemini's 0-1000 normalization is relative to). */
  sentWidth: number;
  sentHeight: number;
}

/** A detection after being mapped back into original-image pixel space and deduplicated across crops — still BEFORE the OpenCV structural combination step. */
export interface DenormalizedDetection {
  category: FurnitureCategory;
  label: string;
  roomType: string | null;
  confidence: number;
  boxOriginalPixels: Box;
  polygonOriginalPixels: Point[] | null;
  /** Which crop(s) this detection was seen in — kept for dedup diagnostics, not part of the final public shape. */
  sourceCropIds: string[];
}

/** Final, fully-processed detection — the shape requirement #IMPLEMENTAÇÃO ISOLADA asks for verbatim. */
export interface FurnitureDetection {
  id: string;
  category: FurnitureCategory;
  label: string;
  roomType: string | null;
  confidence: number;
  boxNormalized: Box;
  boxOriginalPixels: Box;
  polygonNormalized: Point[] | null;
  polygonOriginalPixels: Point[] | null;
  replaceable: boolean;
  uncertain: boolean;
  reason: string;
}

/** Outcome of one attempted Gemini request — one per crop actually sent, in call order. Populated whether the call succeeded or failed, so a partial run (e.g. tile-2 failing) still reports exactly what happened to tile-1 and the overview. */
export interface CropCallOutcome {
  cropId: string;
  variant: 'overview' | 'tile';
  success: boolean;
  elapsedMs: number;
  detectionCount?: number;
  /** Sanitized (no key/base64/headers) — present only when success is false. */
  errorMessage?: string;
}

export interface FurnitureDetectionReport {
  detections: FurnitureDetection[];
  originalWidth: number;
  originalHeight: number;
  usefulArea: PixelRect;
  crops: SourceCrop[];
  callOutcomes: CropCallOutcome[];
  geminiCallCount: number;
  model: string;
  thinkingLevel: string;
  totalTimeMs: number;
}
