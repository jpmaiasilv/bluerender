/**
 * Types for the OpenAI semantic furniture/room-recognition pipeline —
 * deliberately separate from types.ts's Gemini-shaped types (RawGeminiDetection,
 * FurnitureCategory enum, etc.), which stay in the codebase untouched per
 * "mantenha os arquivos existentes" but are no longer on the active path.
 *
 * Coordinate convention (single, explicit, used everywhere in this
 * pipeline): every `Box`/point here is in PIXELS relative to the exact
 * image that was actually sent to OpenAI for that request (a crop's own
 * sent dimensions — see SourceCrop.sentWidth/sentHeight in types.ts) — NOT
 * normalized to 0-1 or 0-1000. This was a deliberate choice: with
 * `detail: "original"` (see config/openaiModels.ts) the model sees the
 * image at its exact real resolution with no server-side resizing, so
 * asking it to report the pixel coordinates it can directly read off that
 * image is more natural than an extra normalization round-trip, and avoids
 * re-deriving a convention already specific to Gemini's own API. Converting
 * a crop-local pixel box back into ORIGINAL-image pixel coordinates happens
 * in exactly one place — openaiCoordinateTransform.ts — never inline
 * elsewhere.
 */

import { DiscardedDetection, ObjectFilterMetrics } from './openaiResponseSchema';

export interface OpenAIBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface OpenAIPolygonPoint {
  x: number;
  y: number;
}

export interface OpenAIRoomDetection {
  id: string;
  type: string;
  label: string | null;
  confidence: number;
  box: OpenAIBox;
}

export interface OpenAIObjectDetection {
  id: string;
  category: string;
  subcategory: string | null;
  roomType: string | null;
  confidence: number;
  orientationDegrees: number | null;
  box: OpenAIBox;
  polygon: OpenAIPolygonPoint[] | null;
  replaceable: boolean;
  notes: string | null;
}

/** The exact shape requested — one full response per crop (overview or tile), still in that crop's own local pixel space. `rooms`/`objects` are ONLY the individually-accepted detections; `discardedRooms`/`discardedObjects` + the two metrics objects account for everything the model returned (see openaiResponseSchema.ts's filterObjectDetections/filterRoomDetections — a single implausible detection is dropped on its own, never voiding the rest of the response). */
export interface OpenAIVisionResult {
  imageWidth: number;
  imageHeight: number;
  rooms: OpenAIRoomDetection[];
  objects: OpenAIObjectDetection[];
  warnings: string[];
  objectMetrics: ObjectFilterMetrics;
  roomMetrics: ObjectFilterMetrics;
  discardedObjects: DiscardedDetection[];
  discardedRooms: DiscardedDetection[];
}

/** A room/object after being mapped into ORIGINAL-image pixel space — still per-crop, before deduplication across crops. */
export interface DenormalizedOpenAIRoom extends Omit<OpenAIRoomDetection, 'box'> {
  boxOriginalPixels: OpenAIBox;
  sourceCropIds: string[];
}

export interface DenormalizedOpenAIObject extends Omit<OpenAIObjectDetection, 'box' | 'polygon'> {
  boxOriginalPixels: OpenAIBox;
  polygonOriginalPixels: OpenAIPolygonPoint[] | null;
  sourceCropIds: string[];
}

/** Final, fully-processed object — after dedup + combination with the OpenCV structural mask. `replaceable`/`uncertain`/`reason` here are OUR pipeline's own verdict, which may downgrade (never upgrade) the model's own `replaceable` self-report — see combineWithStructureOpenAI.ts. */
export interface FinalOpenAIObject {
  id: string;
  category: string;
  subcategory: string | null;
  roomType: string | null;
  confidence: number;
  orientationDegrees: number | null;
  boxOriginalPixels: OpenAIBox;
  polygonOriginalPixels: OpenAIPolygonPoint[] | null;
  /** The model's own opinion — kept for transparency, never used directly as the pipeline's authority. */
  modelReplaceable: boolean;
  notes: string | null;
  /** OUR verdict: true only when confidence is sufficient AND the candidate region doesn't collide with protected structure beyond the configured tolerance. */
  replaceable: boolean;
  uncertain: boolean;
  reason: string;
}

export interface FinalOpenAIRoom {
  id: string;
  type: string;
  label: string | null;
  confidence: number;
  boxOriginalPixels: OpenAIBox;
}
