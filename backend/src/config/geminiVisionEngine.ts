/**
 * Config for the Gemini semantic-detection step of Planta Humanizada
 * (furniture/room recognition only — no image generation, no FLUX call, no
 * credit debit ever happens in this module or anything it configures). Kept
 * entirely separate from providers/bflFill.ts and config/humanizedFloorplanEngine.ts
 * on purpose — this step is free-tier read-only vision, not a paid
 * generation provider.
 *
 * Model chosen after checking the official docs (ai.google.dev/gemini-api)
 * on 2026-09-18: "gemini-3.8-flash" is the current STABLE (not
 * Preview/Experimental) model whose own object-detection/segmentation guide
 * examples all target it, and it's listed as available on the Free Tier.
 * Configurable via GEMINI_VISION_MODEL specifically so this can be changed
 * without a code edit if Google's free-tier lineup moves on.
 */
export const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-3.8-flash';

export const GEMINI_VISION_THINKING_LEVELS = ['low', 'medium', 'high'] as const;
export type GeminiVisionThinkingLevel = (typeof GEMINI_VISION_THINKING_LEVELS)[number];

/**
 * The docs' own segmentation guide sample uses `thinking_level: "minimal"`,
 * but gemini-3.8-flash's API rejected that with HTTP 400: "'minimal' is not
 * a supported thinking level for this model. Allowed values are: high, low,
 * medium." (confirmed directly from the live API response on 2026-09-18,
 * not just docs). "low" is the closest equivalent to the docs' intent
 * (minimal reasoning, faster/cheaper) among the values this model actually
 * accepts. Configurable via GEMINI_VISION_THINKING_LEVEL, but restricted to
 * exactly the three accepted values — see assertValidThinkingLevel below,
 * which runs before every request and is covered by a local test that
 * rejects "minimal" and any other value offline, before it could ever reach
 * the API and waste a call.
 */
const DEFAULT_THINKING_LEVEL: GeminiVisionThinkingLevel = 'low';

/** Exported (not just used internally) specifically so a local test can exercise it with arbitrary input — e.g. "minimal" — without needing to re-import this module under a different env var. */
export function resolveThinkingLevel(raw: string | undefined): GeminiVisionThinkingLevel {
  if (!raw) return DEFAULT_THINKING_LEVEL;
  if ((GEMINI_VISION_THINKING_LEVELS as readonly string[]).includes(raw)) {
    return raw as GeminiVisionThinkingLevel;
  }
  throw new Error(
    `Invalid GEMINI_VISION_THINKING_LEVEL "${raw}" — must be one of: ${GEMINI_VISION_THINKING_LEVELS.join(', ')}. Refusing to start rather than send a value the API will reject.`
  );
}

export const GEMINI_VISION_THINKING_LEVEL: GeminiVisionThinkingLevel = resolveThinkingLevel(process.env.GEMINI_VISION_THINKING_LEVEL);

/** Local guard called right before every Gemini request — throws (never sends the request) if somehow given a value outside the three the model accepts. */
export function assertValidThinkingLevel(value: string): asserts value is GeminiVisionThinkingLevel {
  if (!(GEMINI_VISION_THINKING_LEVELS as readonly string[]).includes(value)) {
    throw new Error(`Invalid thinking_level "${value}" — must be one of: ${GEMINI_VISION_THINKING_LEVELS.join(', ')}.`);
  }
}

const MIN_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * The overview call's first real attempt (heavier than it needed to be —
 * see the two-phase split above) timed out at the old fixed 60s. 180s is
 * the new default, but still bounded to [60s, 300s]: too low risks the same
 * timeout, too high risks a single hung request blocking the whole
 * inspection for an unreasonable time. Configurable via
 * GEMINI_VISION_TIMEOUT_MS, validated the same fail-fast way as
 * thinking_level — an out-of-range value refuses to start rather than
 * silently clamping to something the caller didn't ask for.
 */
export function resolveTimeoutMs(raw: string | undefined): number {
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new Error(`Invalid GEMINI_VISION_TIMEOUT_MS "${raw}" — must be a number between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}.`);
  }
  return value;
}

export const GEMINI_VISION_TIMEOUT_MS: number = resolveTimeoutMs(process.env.GEMINI_VISION_TIMEOUT_MS);

/**
 * Field name confirmed directly from @google/genai's own shipped type
 * declarations (GenerationConfig_2 in dist/genai.d.ts, the same interaction
 * generation_config type thinking_level belongs to) — not guessed. A
 * generous-but-bounded default: structured JSON with up to a few dozen
 * detected objects, each with a short polygon, comfortably fits well under
 * this on gemini-3.8-flash.
 */
export const GEMINI_VISION_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_VISION_MAX_OUTPUT_TOKENS) || 8192;

/**
 * Detection runs on a downscaled copy of each crop/tile for speed and to
 * stay within a sane payload size — long side capped here. Kept well above
 * what's needed for object-level (not fine-print) reading, per requirement
 * "não redimensione de modo que ... móveis pequenos deixem de ser legíveis".
 */
export const GEMINI_VISION_MAX_IMAGE_DIMENSION = 1536;

/** If the useful-area crop's long side exceeds this (at working resolution), it gets split into overlapping tiles instead of a single overview-only pass. */
export const GEMINI_VISION_TILE_THRESHOLD_PX = 1400;

/** Fraction of a tile's own dimension reserved as overlap with its neighbor, so objects straddling a tile boundary are fully visible in at least one tile. */
export const GEMINI_VISION_TILE_OVERLAP_FRACTION = 0.2;

/** Safety margin (in original-image pixels) added around the detected useful/drawn area before cropping — keeps thin border walls/dimension marks from being clipped. */
export const GEMINI_VISION_USEFUL_AREA_MARGIN_PX = 24;

/** Detections below this confidence are rejected outright (never marked replaceable, excluded from the editable-furniture set). */
export const GEMINI_VISION_MIN_CONFIDENCE = 0.5;

/**
 * How much of a candidate furniture mask is allowed to overlap the
 * protected structural mask (walls/doors/windows/stairs/text/dimensions)
 * before the object is downgraded from "replaceable" to "uncertain" instead
 * of being trusted as a clean, fully separable region.
 */
export const GEMINI_VISION_MAX_STRUCTURE_OVERLAP_RATIO = 0.35;

/** Extra dilation (original-image pixels) applied to the structural mask specifically when subtracting it from furniture candidates — keeps a visible gap between "protected" and "replaceable" pixels instead of them touching edge-to-edge. */
export const GEMINI_VISION_FURNITURE_SAFETY_MARGIN_PX = 4;
