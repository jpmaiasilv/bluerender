import { z } from 'zod';
import { FURNITURE_CATEGORIES } from './types';

/**
 * Structural validation for Gemini's raw output — nothing from Gemini is
 * ever trusted until it passes this. A response that fails validation is
 * treated as a detection failure for that crop (throws), never silently
 * coerced into a best guess.
 *
 * Two variants, not one, per the two-phase pipeline (see providers/geminiVision.ts):
 *  - "overview": a fast, cheap first pass over the whole plan — boxes only,
 *    no segmentation mask. Its only job is to locate rooms/objects and
 *    orient the more expensive detailed pass; a heavy request (asking for
 *    polygons on every object) here is what pushed the first attempt of
 *    this pass past its timeout.
 *  - "tile": the detailed pass over one zoomed-in section — full
 *    segmentation polygon requested (still nullable as an escape hatch for
 *    an object Gemini genuinely can't outline cleanly).
 */

const Box2dSchema = z
  .array(z.number())
  .length(4, 'box_2d must have exactly 4 numbers [ymin, xmin, ymax, xmax]')
  .refine((box) => box.every((n) => Number.isFinite(n)), 'box_2d values must be finite numbers');

const MaskPointSchema = z
  .array(z.number())
  .length(2, 'each mask point must be exactly [x, y]')
  .refine((p) => p.every((n) => Number.isFinite(n)), 'mask point values must be finite numbers');

const CommonFields = {
  category: z.enum(FURNITURE_CATEGORIES),
  label: z.string().min(1).max(200),
  roomType: z.string().max(200).nullable(),
  confidence: z.number().min(0).max(1),
  box_2d: Box2dSchema,
};

// --- Overview: boxes only, no mask field at all. ---
export const GeminiOverviewItemSchema = z.object(CommonFields);
export const GeminiOverviewResponseSchema = z.object({ objects: z.array(GeminiOverviewItemSchema) });
export type GeminiOverviewResponse = z.infer<typeof GeminiOverviewResponseSchema>;

// --- Tile: boxes + segmentation polygon (nullable escape hatch). ---
export const GeminiTileItemSchema = z.object({ ...CommonFields, mask: z.array(MaskPointSchema).min(3).nullable() });
export const GeminiTileResponseSchema = z.object({ objects: z.array(GeminiTileItemSchema) });
export type GeminiTileResponse = z.infer<typeof GeminiTileResponseSchema>;

const COMMON_JSON_PROPERTIES = {
  category: { type: 'string', enum: [...FURNITURE_CATEGORIES] },
  label: { type: 'string' },
  // Gemini's structured-output schema validator historically follows
  // OpenAPI 3.0 semantics (a single `type` string + a separate `nullable`
  // boolean), NOT JSON-Schema-2020-12's `type: [x,"null"]` array form —
  // using the latter caused an immediate HTTP 400 on the first real call
  // against gemini-3.8-flash (2026-09-18). Fixed to the OpenAPI-3.0 form.
  roomType: { type: 'string', nullable: true },
  confidence: { type: 'number' },
  box_2d: {
    type: 'array',
    items: { type: 'number' },
    minItems: 4,
    maxItems: 4,
    description: '[ymin, xmin, ymax, xmax] normalized to 0-1000',
  },
} as const;

/**
 * Hand-written JSON Schema twins of the Zod schemas above, used for the
 * REQUEST's response_format.schema. The docs' own examples derive this
 * automatically via `z.toJSONSchema()`, but that's a Zod v4 API and this
 * project's installed zod (3.25.76) is a transitive dependency several of
 * jimp's plugins pin to `^3.23.8` — upgrading it project-wide to pull in v4
 * risked breaking the image pipeline for a cosmetic convenience, so these
 * are kept in sync by hand instead. Keep in lockstep with the Zod schemas
 * above when either changes (see test-floorplan-furniture.ts's schema
 * self-check, which runs before every real request too).
 */
export const GEMINI_OVERVIEW_JSON_SCHEMA = {
  type: 'object',
  properties: {
    objects: {
      type: 'array',
      items: {
        type: 'object',
        properties: { ...COMMON_JSON_PROPERTIES },
        required: ['category', 'label', 'roomType', 'confidence', 'box_2d'],
      },
    },
  },
  required: ['objects'],
} as const;

export const GEMINI_TILE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    objects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ...COMMON_JSON_PROPERTIES,
          mask: {
            type: 'array',
            nullable: true,
            items: {
              type: 'array',
              items: { type: 'number' },
              minItems: 2,
              maxItems: 2,
            },
            description: 'Segmentation polygon as [[x,y], ...] normalized to 0-1000, or null if a clean polygon cannot be given.',
          },
        },
        required: ['category', 'label', 'roomType', 'confidence', 'box_2d', 'mask'],
      },
    },
  },
  required: ['objects'],
} as const;

/** Parses + validates Gemini's `output_text` (a JSON string) from an OVERVIEW call. Throws on any failure — never returns a partially-trusted result. */
export function parseGeminiOverviewResponse(outputText: string): GeminiOverviewResponse {
  const parsed = parseJson(outputText);
  const result = GeminiOverviewResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Gemini overview response failed schema validation: ${result.error.message}`);
  }
  return result.data;
}

/** Same as above, for a TILE call's response (requires the mask field, though its value may be null). */
export function parseGeminiTileResponse(outputText: string): GeminiTileResponse {
  const parsed = parseJson(outputText);
  const result = GeminiTileResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Gemini tile response failed schema validation: ${result.error.message}`);
  }
  return result.data;
}

function parseJson(outputText: string): unknown {
  try {
    return JSON.parse(outputText);
  } catch (err) {
    throw new Error(`Gemini response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}
