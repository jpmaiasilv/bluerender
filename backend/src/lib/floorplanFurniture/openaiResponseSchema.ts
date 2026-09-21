import { z } from 'zod';
import {
  OPENAI_VISION_MAX_OBJECT_AREA_RATIO,
  OPENAI_VISION_MIN_OBJECT_DIMENSION_PX,
  OPENAI_VISION_OVERVIEW_MIN_AREA_RATIO,
  OPENAI_VISION_TILE_MIN_AREA_RATIO,
} from '../../config/openaiModels';

/**
 * Two-stage validation for OpenAI's raw output, deliberately kept SEPARATE
 * (requirement, after the 2026-09-19 real-run failure):
 *
 *  1. STRUCTURAL (this file's Zod schemas): format, types, required fields,
 *     coordinate ordering (xMax>xMin etc). A failure here means the
 *     response genuinely doesn't match the shape OpenAI's own strict JSON
 *     Schema mode was supposed to guarantee — rare, and correctly still
 *     fatal for the whole crop (see parseOpenAIOverviewResponse/
 *     parseOpenAITileResponse, which throw a plain Error for this case;
 *     providers/openaiVision.ts wraps that into AppError('VALIDATION_ERROR', ...)).
 *
 *  2. SEMANTIC PLAUSIBILITY (filterObjectDetections/filterRoomDetections,
 *     applied AFTER a successful structural parse): is this box a
 *     plausible size/position for a real object, given the crop it was
 *     found in? A detection failing this is discarded INDIVIDUALLY — it
 *     never voids the rest of the response. This is the fix for the actual
 *     2026-09-19 bug: the old code ran this exact size check INSIDE the
 *     Zod `.refine()` on each array element, so one implausible object
 *     failed `safeParse` for the ENTIRE objects array, discarding 6 good
 *     detections along with 10 bad ones and aborting the whole job.
 *
 * Overview and tile crops get DIFFERENT semantic thresholds — see
 * config/openaiModels.ts for the full reasoning (overview crops can be an
 * entire multi-room floor plan; tile crops are already zoomed to roughly
 * one room/section).
 */

const BoxSchema = z
  .object({
    xMin: z.number(),
    yMin: z.number(),
    xMax: z.number(),
    yMax: z.number(),
  })
  .refine((b) => b.xMin >= 0 && b.yMin >= 0, { message: 'box coordinates must not be negative' })
  .refine((b) => b.xMax > b.xMin, { message: 'box.xMax must be greater than box.xMin' })
  .refine((b) => b.yMax > b.yMin, { message: 'box.yMax must be greater than box.yMin' });

const PolygonPointSchema = z.object({ x: z.number(), y: z.number() });

const RoomSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1, 'room type must not be empty'),
  label: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  box: BoxSchema,
});

const OverviewObjectSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1, 'category must not be empty'),
  subcategory: z.string().nullable(),
  roomType: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  orientationDegrees: z.number().nullable(),
  box: BoxSchema,
  replaceable: z.boolean(),
  notes: z.string().nullable(),
});

const TileObjectSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1, 'category must not be empty'),
  subcategory: z.string().nullable(),
  roomType: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  orientationDegrees: z.number().nullable(),
  box: BoxSchema,
  polygon: z.array(PolygonPointSchema).min(3).nullable(),
  replaceable: z.boolean(),
  notes: z.string().nullable(),
});

export function buildOpenAIOverviewSchema() {
  return z.object({
    imageWidth: z.number().positive(),
    imageHeight: z.number().positive(),
    rooms: z.array(RoomSchema),
    objects: z.array(OverviewObjectSchema),
    warnings: z.array(z.string()),
  });
}

export function buildOpenAITileSchema() {
  return z.object({
    imageWidth: z.number().positive(),
    imageHeight: z.number().positive(),
    rooms: z.array(RoomSchema),
    objects: z.array(TileObjectSchema),
    warnings: z.array(z.string()),
  });
}

export type OpenAIOverviewParsed = z.infer<ReturnType<typeof buildOpenAIOverviewSchema>>;
export type OpenAITileParsed = z.infer<ReturnType<typeof buildOpenAITileSchema>>;

function parseJson(outputText: string): unknown {
  try {
    return JSON.parse(outputText);
  } catch (err) {
    throw new Error(`OpenAI response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// --- Semantic plausibility (per-detection, never fails the whole array) ---

export type ObjectDiscardReasonCode =
  | 'degenerate_dimensions'
  | 'out_of_bounds'
  | 'below_pixel_floor'
  | 'below_area_ratio_floor'
  | 'above_area_ratio_ceiling'
  | 'polygon_out_of_bounds';

/** Never includes image data, the prompt, or any secret — just computed numbers and a fixed reason code, safe to log/persist for diagnostics. */
export interface DiscardedDetection {
  index: number;
  category: string;
  reasonCode: ObjectDiscardReasonCode;
  reason: string;
  widthPx: number;
  heightPx: number;
  areaRatio: number;
}

export interface AcceptedSizeStats {
  minAreaPx: number;
  maxAreaPx: number;
  minWidthPx: number;
  maxWidthPx: number;
  minHeightPx: number;
  maxHeightPx: number;
}

export interface ObjectFilterMetrics {
  totalReceived: number;
  totalAccepted: number;
  totalDiscarded: number;
  discardReasonsGrouped: Partial<Record<ObjectDiscardReasonCode, number>>;
  acceptedSizeStats: AcceptedSizeStats | null;
}

export interface FilterResult<T> {
  accepted: T[];
  discarded: DiscardedDetection[];
  metrics: ObjectFilterMetrics;
}

interface BoxLike {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

type BoxVerdict =
  | { ok: true; widthPx: number; heightPx: number; areaRatio: number }
  | { ok: false; code: ObjectDiscardReasonCode; reason: string; widthPx: number; heightPx: number; areaRatio: number };

/**
 * `minAreaRatio`/`maxAreaRatio` of `null` skips that check entirely — used
 * for rooms, which can legitimately span almost any fraction of their crop
 * (a studio apartment's single room can be ~100% of the overview), so no
 * ratio floor/ceiling is meaningful for them. Objects always pass concrete
 * numbers (variant-specific — see config/openaiModels.ts).
 */
function evaluateBoxPlausibility(box: BoxLike, cropWidth: number, cropHeight: number, minAreaRatio: number | null, maxAreaRatio: number | null): BoxVerdict {
  const widthPx = box.xMax - box.xMin;
  const heightPx = box.yMax - box.yMin;
  const cropArea = cropWidth * cropHeight;
  const areaRatio = cropArea > 0 ? (widthPx * heightPx) / cropArea : 0;

  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
    return { ok: false, code: 'degenerate_dimensions', reason: `dimensões não positivas (${widthPx.toFixed(1)}x${heightPx.toFixed(1)}px)`, widthPx, heightPx, areaRatio };
  }
  if (box.xMin < 0 || box.yMin < 0 || box.xMax > cropWidth || box.yMax > cropHeight) {
    return { ok: false, code: 'out_of_bounds', reason: `caixa fora dos limites do recorte enviado (${cropWidth}x${cropHeight}px)`, widthPx, heightPx, areaRatio };
  }
  if (widthPx < OPENAI_VISION_MIN_OBJECT_DIMENSION_PX || heightPx < OPENAI_VISION_MIN_OBJECT_DIMENSION_PX) {
    return {
      ok: false,
      code: 'below_pixel_floor',
      reason: `menor que o piso absoluto de ${OPENAI_VISION_MIN_OBJECT_DIMENSION_PX}px em pelo menos uma dimensão (${widthPx.toFixed(1)}x${heightPx.toFixed(1)}px)`,
      widthPx,
      heightPx,
      areaRatio,
    };
  }
  if (minAreaRatio !== null && areaRatio < minAreaRatio) {
    return {
      ok: false,
      code: 'below_area_ratio_floor',
      reason: `área (${(areaRatio * 100).toFixed(5)}%) abaixo do piso mínimo (${(minAreaRatio * 100).toFixed(5)}%)`,
      widthPx,
      heightPx,
      areaRatio,
    };
  }
  if (maxAreaRatio !== null && areaRatio > maxAreaRatio) {
    return {
      ok: false,
      code: 'above_area_ratio_ceiling',
      reason: `área (${(areaRatio * 100).toFixed(1)}%) acima do teto máximo (${(maxAreaRatio * 100).toFixed(0)}%)`,
      widthPx,
      heightPx,
      areaRatio,
    };
  }
  return { ok: true, widthPx, heightPx, areaRatio };
}

function polygonIsWithinBounds(polygon: { x: number; y: number }[], cropWidth: number, cropHeight: number): boolean {
  return polygon.every((p) => p.x >= 0 && p.x <= cropWidth && p.y >= 0 && p.y <= cropHeight);
}

function buildMetrics(totalReceived: number, acceptedBoxes: BoxLike[], discarded: DiscardedDetection[]): ObjectFilterMetrics {
  const discardReasonsGrouped: Partial<Record<ObjectDiscardReasonCode, number>> = {};
  for (const d of discarded) {
    discardReasonsGrouped[d.reasonCode] = (discardReasonsGrouped[d.reasonCode] ?? 0) + 1;
  }
  let acceptedSizeStats: AcceptedSizeStats | null = null;
  if (acceptedBoxes.length > 0) {
    const widths = acceptedBoxes.map((b) => b.xMax - b.xMin);
    const heights = acceptedBoxes.map((b) => b.yMax - b.yMin);
    const areas = widths.map((w, i) => w * heights[i]);
    acceptedSizeStats = {
      minAreaPx: Math.min(...areas),
      maxAreaPx: Math.max(...areas),
      minWidthPx: Math.min(...widths),
      maxWidthPx: Math.max(...widths),
      minHeightPx: Math.min(...heights),
      maxHeightPx: Math.max(...heights),
    };
  }
  return { totalReceived, totalAccepted: acceptedBoxes.length, totalDiscarded: discarded.length, discardReasonsGrouped, acceptedSizeStats };
}

/**
 * Filters a parsed objects array individually against the given variant's
 * thresholds (requirement: overview accepts small candidates, tiles can be
 * stricter — never a single arbitrarily-lowered global floor). A degenerate
 * box, an out-of-bounds box, a box under the absolute pixel floor, a box
 * outside the variant's area-ratio range, or (for tile objects) a polygon
 * with a point outside the crop are all discarded INDIVIDUALLY — every
 * other object in the same response is unaffected.
 */
export function filterObjectDetections<T extends { category: string; box: BoxLike; polygon?: { x: number; y: number }[] | null }>(
  objects: T[],
  cropWidth: number,
  cropHeight: number,
  variant: 'overview' | 'tile'
): FilterResult<T> {
  const minAreaRatio = variant === 'overview' ? OPENAI_VISION_OVERVIEW_MIN_AREA_RATIO : OPENAI_VISION_TILE_MIN_AREA_RATIO;
  const accepted: T[] = [];
  const discarded: DiscardedDetection[] = [];

  objects.forEach((obj, index) => {
    const verdict = evaluateBoxPlausibility(obj.box, cropWidth, cropHeight, minAreaRatio, OPENAI_VISION_MAX_OBJECT_AREA_RATIO);
    if (!verdict.ok) {
      discarded.push({ index, category: obj.category, reasonCode: verdict.code, reason: verdict.reason, widthPx: verdict.widthPx, heightPx: verdict.heightPx, areaRatio: verdict.areaRatio });
      return;
    }
    if (obj.polygon && obj.polygon.length > 0 && !polygonIsWithinBounds(obj.polygon, cropWidth, cropHeight)) {
      discarded.push({
        index,
        category: obj.category,
        reasonCode: 'polygon_out_of_bounds',
        reason: 'polígono possui ponto fora dos limites do recorte enviado',
        widthPx: verdict.widthPx,
        heightPx: verdict.heightPx,
        areaRatio: verdict.areaRatio,
      });
      return;
    }
    accepted.push(obj);
  });

  return { accepted, discarded, metrics: buildMetrics(objects.length, accepted.map((o) => o.box), discarded) };
}

/**
 * Same individual-discard principle for rooms, but WITHOUT any area-ratio
 * check (a room can legitimately be almost any fraction of its crop) — only
 * degenerate dimensions, out-of-bounds, and the absolute pixel floor apply.
 */
export function filterRoomDetections<T extends { type: string; box: BoxLike }>(rooms: T[], cropWidth: number, cropHeight: number): FilterResult<T> {
  const accepted: T[] = [];
  const discarded: DiscardedDetection[] = [];

  rooms.forEach((room, index) => {
    const verdict = evaluateBoxPlausibility(room.box, cropWidth, cropHeight, null, null);
    if (!verdict.ok) {
      discarded.push({ index, category: room.type, reasonCode: verdict.code, reason: verdict.reason, widthPx: verdict.widthPx, heightPx: verdict.heightPx, areaRatio: verdict.areaRatio });
      return;
    }
    accepted.push(room);
  });

  return { accepted, discarded, metrics: buildMetrics(rooms.length, accepted.map((r) => r.box), discarded) };
}

export interface ParsedAndFilteredOverview {
  imageWidth: number;
  imageHeight: number;
  rooms: OpenAIOverviewParsed['rooms'];
  objects: OpenAIOverviewParsed['objects'];
  warnings: string[];
  objectMetrics: ObjectFilterMetrics;
  roomMetrics: ObjectFilterMetrics;
  discardedObjects: DiscardedDetection[];
  discardedRooms: DiscardedDetection[];
}

export interface ParsedAndFilteredTile {
  imageWidth: number;
  imageHeight: number;
  rooms: OpenAITileParsed['rooms'];
  objects: OpenAITileParsed['objects'];
  warnings: string[];
  objectMetrics: ObjectFilterMetrics;
  roomMetrics: ObjectFilterMetrics;
  discardedObjects: DiscardedDetection[];
  discardedRooms: DiscardedDetection[];
}

/** Throws a plain Error ONLY for a genuine structural failure (malformed JSON, wrong types, missing required fields, degenerate box ordering) — never for a semantically-implausible-but-well-formed detection, which is filtered individually below instead. providers/openaiVision.ts wraps this throw into AppError('VALIDATION_ERROR', ...). */
export function parseOpenAIOverviewResponse(outputText: string, cropWidth: number, cropHeight: number): ParsedAndFilteredOverview {
  const parsed = parseJson(outputText);
  const result = buildOpenAIOverviewSchema().safeParse(parsed);
  if (!result.success) {
    throw new Error(`OpenAI overview response failed schema validation: ${result.error.message}`);
  }
  const objectFilter = filterObjectDetections(result.data.objects, cropWidth, cropHeight, 'overview');
  const roomFilter = filterRoomDetections(result.data.rooms, cropWidth, cropHeight);
  return {
    imageWidth: result.data.imageWidth,
    imageHeight: result.data.imageHeight,
    rooms: roomFilter.accepted,
    objects: objectFilter.accepted,
    warnings: result.data.warnings,
    objectMetrics: objectFilter.metrics,
    roomMetrics: roomFilter.metrics,
    discardedObjects: objectFilter.discarded,
    discardedRooms: roomFilter.discarded,
  };
}

export function parseOpenAITileResponse(outputText: string, cropWidth: number, cropHeight: number): ParsedAndFilteredTile {
  const parsed = parseJson(outputText);
  const result = buildOpenAITileSchema().safeParse(parsed);
  if (!result.success) {
    throw new Error(`OpenAI tile response failed schema validation: ${result.error.message}`);
  }
  const objectFilter = filterObjectDetections(result.data.objects, cropWidth, cropHeight, 'tile');
  const roomFilter = filterRoomDetections(result.data.rooms, cropWidth, cropHeight);
  return {
    imageWidth: result.data.imageWidth,
    imageHeight: result.data.imageHeight,
    rooms: roomFilter.accepted,
    objects: objectFilter.accepted,
    warnings: result.data.warnings,
    objectMetrics: objectFilter.metrics,
    roomMetrics: roomFilter.metrics,
    discardedObjects: objectFilter.discarded,
    discardedRooms: roomFilter.discarded,
  };
}

// --- Strict JSON Schema (request-side, response_format.text.format.schema) ---
//
// OpenAI's Structured Outputs strict mode uses a DIFFERENT nullable
// convention than Gemini: `"type": ["string", "null"]` (JSON-Schema-2020-12
// array form), NOT `"nullable": true` (which is Gemini/OpenAPI-3.0 style —
// see geminiResponseSchema.ts). Confirmed directly from the installed
// `openai` SDK's own vendored zod-to-json-schema converter
// (src/_vendor/zod-to-json-schema/parsers/nullable.ts), which is what
// OpenAI's own `zodResponseFormat()` helper produces for a plain nullable
// primitive when NOT targeting openApi3 — i.e. exactly the strict-mode path
// this integration uses. Every object below also sets
// `additionalProperties: false` and lists EVERY key (including nullable
// ones) in `required`, both hard requirements of OpenAI's strict mode.

const BOX_JSON_SCHEMA = {
  type: 'object',
  properties: {
    xMin: { type: 'number' },
    yMin: { type: 'number' },
    xMax: { type: 'number' },
    yMax: { type: 'number' },
  },
  required: ['xMin', 'yMin', 'xMax', 'yMax'],
  additionalProperties: false,
} as const;

const ROOM_JSON_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string' },
    label: { type: ['string', 'null'] },
    confidence: { type: 'number' },
    box: BOX_JSON_SCHEMA,
  },
  required: ['id', 'type', 'label', 'confidence', 'box'],
  additionalProperties: false,
} as const;

function buildObjectJsonSchema(includePolygon: boolean) {
  const base = {
    id: { type: 'string' },
    category: { type: 'string' },
    subcategory: { type: ['string', 'null'] },
    roomType: { type: ['string', 'null'] },
    confidence: { type: 'number' },
    orientationDegrees: { type: ['number', 'null'] },
    box: BOX_JSON_SCHEMA,
    replaceable: { type: 'boolean' },
    notes: { type: ['string', 'null'] },
  } as Record<string, unknown>;

  const required = ['id', 'category', 'subcategory', 'roomType', 'confidence', 'orientationDegrees', 'box', 'replaceable', 'notes'];

  if (includePolygon) {
    base.polygon = {
      type: ['array', 'null'],
      items: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' } },
        required: ['x', 'y'],
        additionalProperties: false,
      },
    };
    required.push('polygon');
  }

  return { type: 'object', properties: base, required, additionalProperties: false } as const;
}

export const OPENAI_OVERVIEW_JSON_SCHEMA = {
  type: 'object',
  properties: {
    imageWidth: { type: 'number' },
    imageHeight: { type: 'number' },
    rooms: { type: 'array', items: ROOM_JSON_SCHEMA },
    objects: { type: 'array', items: buildObjectJsonSchema(false) },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['imageWidth', 'imageHeight', 'rooms', 'objects', 'warnings'],
  additionalProperties: false,
} as const;

export const OPENAI_TILE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    imageWidth: { type: 'number' },
    imageHeight: { type: 'number' },
    rooms: { type: 'array', items: ROOM_JSON_SCHEMA },
    objects: { type: 'array', items: buildObjectJsonSchema(true) },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['imageWidth', 'imageHeight', 'rooms', 'objects', 'warnings'],
  additionalProperties: false,
} as const;
