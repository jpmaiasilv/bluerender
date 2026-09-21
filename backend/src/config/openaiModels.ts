/**
 * Config for the OpenAI semantic-vision step of Planta Humanizada (furniture
 * /room recognition) and the (not-yet-called) block-image generator. Kept
 * entirely separate from providers/bfl.ts, providers/bflFill.ts, and
 * providers/geminiVision.ts on purpose — this is a distinct provider with
 * its own auth, its own SDK, its own request/response shapes.
 *
 * Neither model name is hardcoded anywhere else in the codebase — every
 * call site imports OPENAI_VISION_MODEL / OPENAI_BLOCK_IMAGE_MODEL from
 * here, so either can be changed by environment variable alone.
 */

/**
 * Confirmed as a real, current model literal directly in the installed
 * `openai` SDK's own type declarations (resources/responses.d.ts's
 * ResponsesModel union includes 'gpt-5.6-terra' verbatim) — not guessed.
 */
export const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-5.6-terra';

/**
 * Confirmed the same way — 'gpt-image-2.5-sunburst' appears verbatim in the
 * SDK's ImageModel union (resources/images.d.ts).
 */
export const OPENAI_BLOCK_IMAGE_MODEL = process.env.OPENAI_BLOCK_IMAGE_MODEL || 'gpt-image-2.5-sunburst';

/**
 * Per explicit requirement: full resolution, no server-side downscaling of
 * the image before the model sees it. Confirmed as a real value of the
 * SDK's `ImageDetail` type ('low' | 'high' | 'auto' | 'original'), not
 * invented — see ResponseInputImage.detail in resources/responses.d.ts.
 * Centralized as a constant (not a free string at each call site) even
 * though the requirement doesn't ask for it to be env-configurable, since
 * the whole point of "detail: original" is architectural (pixel-accurate
 * coordinates), not a tunable quality/cost knob like thinking_level was for
 * Gemini.
 */
export const OPENAI_VISION_DETAIL = 'original' as const;

const MIN_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 180_000;

/** Same fail-fast validation pattern used for Gemini's timeout — an out-of-range value refuses to start rather than silently clamping. */
export function resolveOpenAiVisionTimeoutMs(raw: string | undefined): number {
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new Error(`Invalid OPENAI_VISION_TIMEOUT_MS "${raw}" — must be a number between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}.`);
  }
  return value;
}

export const OPENAI_VISION_TIMEOUT_MS: number = resolveOpenAiVisionTimeoutMs(process.env.OPENAI_VISION_TIMEOUT_MS);

/** Field name confirmed from the SDK's own ResponseCreateParamsBase type (`max_output_tokens?: number | null`). */
export const OPENAI_VISION_MAX_OUTPUT_TOKENS = Number(process.env.OPENAI_VISION_MAX_OUTPUT_TOKENS) || 8192;

export const VISION_PROVIDERS = ['openai', 'gemini'] as const;
export type VisionProvider = (typeof VISION_PROVIDERS)[number];

/**
 * Single switch controlling which vision provider the furniture-detection
 * pipeline actually calls. Per explicit requirement: Gemini's code stays in
 * the repo and fully working, just not reachable from the main flow unless
 * this is changed — no code edit needed to reactivate it, only this
 * variable. Defaults to "openai" (the new primary provider).
 */
function resolveVisionProvider(raw: string | undefined): VisionProvider {
  if (!raw) return 'openai';
  if ((VISION_PROVIDERS as readonly string[]).includes(raw)) return raw as VisionProvider;
  throw new Error(`Invalid VISION_PROVIDER "${raw}" — must be one of: ${VISION_PROVIDERS.join(', ')}.`);
}

export const ACTIVE_VISION_PROVIDER: VisionProvider = resolveVisionProvider(process.env.VISION_PROVIDER);

/**
 * Semantic plausibility thresholds for one detected object's bounding box —
 * applied PER OBJECT, AFTER structural JSON-schema validation already
 * passed (see filterObjectDetections in lib/floorplanFurniture/openaiResponseSchema.ts).
 * A single implausible object is discarded individually; it never voids the
 * rest of the response (that was the real-run bug found on 2026-09-19: a
 * Zod `.refine()` on the per-object schema made ANY one bad detection fail
 * the whole array's `safeParse`, throwing away 6 good detections along with
 * 10 bad ones and aborting the entire job with no image ever generated).
 *
 * Overview and tile crops are very different scales and get DIFFERENT
 * minimum-area ratios — never a single global floor:
 *  - The overview crop is the WHOLE useful area of the floor plan (can be an
 *    entire multi-room apartment, easily 1-2 million px² — e.g. the real
 *    planta-tecnica-real-01.jpg run: ~1755x1241 = ~2.18M px²). A real small
 *    fixture (a toilet symbol, a chair) can legitimately be a tiny fraction
 *    of that — a ratio tuned for a zoomed-in tile is far too strict here and
 *    is exactly what discarded 10 real detections in the failed run.
 *  - A tile crop (see tiling.ts's planCropRects, threshold 1400px long side)
 *    is a small, already-zoomed section of the useful area, roughly
 *    room-sized — a ratio floor stays meaningful there, so it keeps the
 *    original, stricter value.
 *
 * Both variants ALSO enforce OPENAI_VISION_MIN_OBJECT_DIMENSION_PX, an
 * ABSOLUTE pixel floor independent of crop size — this is the real defense
 * against pixel-noise-sized "objects" (a 1x1 or 3x2 px box). A ratio floor
 * alone cannot do this job at overview scale, since the same absolute pixel
 * size becomes an ever-smaller ratio as the crop grows; the ratio floors
 * below exist only to additionally reject implausibly small results a
 * pixel-floor-only check might still let through on an unusually small crop.
 */
export const OPENAI_VISION_MIN_OBJECT_DIMENSION_PX = 6;
export const OPENAI_VISION_OVERVIEW_MIN_AREA_RATIO = 0.00002; // 0.002% of the overview crop's area
export const OPENAI_VISION_TILE_MIN_AREA_RATIO = 0.0005; // 0.05% of the tile crop's area — unchanged from the original single threshold
/** Ceiling is the same for both variants: an object should never be reported as most of its own crop, regardless of crop scale. */
export const OPENAI_VISION_MAX_OBJECT_AREA_RATIO = 0.7; // 70% of the crop's area

/** Detections below this confidence are rejected outright downstream (never marked replaceable). */
export const OPENAI_VISION_MIN_CONFIDENCE = 0.5;

/** Same semantics as Gemini's structural-overlap tolerance — see combineWithStructureOpenAI.ts. */
export const OPENAI_VISION_MAX_STRUCTURE_OVERLAP_RATIO = 0.35;
export const OPENAI_VISION_FURNITURE_SAFETY_MARGIN_PX = 4;

/**
 * The heuristic OpenCV suspicious-text detector (floorplanValidation.ts) is
 * known to confuse furniture/rug/texture edges with text-like blobs — it can
 * no longer reject a generation on its own (see decideFinalAcceptance in
 * floorplanValidation.ts). When it flags candidates, a second OpenAI call
 * (providers/openaiTextVerification.ts) compares the original and generated
 * images and is the ONLY thing allowed to turn that into a rejection — and
 * only when it reports both `possuiTextoNovo: true` AND a confidence at or
 * above this threshold.
 */
export const OPENAI_TEXT_VERIFICATION_MIN_CONFIDENCE = 0.6;

/**
 * OpenAI image-model prices, USD per 1,000,000 tokens, read from the
 * environment so they can be updated without a code change. There is NO
 * built-in default on purpose: a price this app has not been told is never
 * guessed, and services/openaiImageCost.ts returns a null cost when any
 * price needed for a used token bucket is unset.
 */
function readPrice(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export const OPENAI_IMAGE_PRICE_TEXT_INPUT_PER_M = readPrice('OPENAI_IMAGE_PRICE_TEXT_INPUT_PER_M');
export const OPENAI_IMAGE_PRICE_IMAGE_INPUT_PER_M = readPrice('OPENAI_IMAGE_PRICE_IMAGE_INPUT_PER_M');
export const OPENAI_IMAGE_PRICE_IMAGE_OUTPUT_PER_M = readPrice('OPENAI_IMAGE_PRICE_IMAGE_OUTPUT_PER_M');

/**
 * GPT-6 Astra — used ONLY as an architectural analysis / validation layer for
 * the premium Planta Humanizada mode. It never renders images. Confirmed as a
 * real literal of the installed SDK's ChatModel union (resources/shared.d.ts).
 */
export const OPENAI_ASTRA_MODEL = process.env.OPENAI_ASTRA_MODEL || 'gpt-6-astra';
export const OPENAI_ASTRA_REASONING_EFFORT = 'medium' as const;
export const OPENAI_ASTRA_VERBOSITY = 'low' as const;
export const OPENAI_ASTRA_TIMEOUT_MS = Number(process.env.OPENAI_ASTRA_TIMEOUT_MS) || 120_000;
export const OPENAI_ASTRA_MAX_OUTPUT_TOKENS = 6000;

/** USD per 1,000,000 tokens for the Astra model. No defaults: an unset price yields a null cost, never a guess. */
export const OPENAI_ASTRA_INPUT_PRICE_PER_M = readPrice('OPENAI_ASTRA_INPUT_PRICE_PER_M');
export const OPENAI_ASTRA_CACHED_INPUT_PRICE_PER_M = readPrice('OPENAI_ASTRA_CACHED_INPUT_PRICE_PER_M');
export const OPENAI_ASTRA_OUTPUT_PRICE_PER_M = readPrice('OPENAI_ASTRA_OUTPUT_PRICE_PER_M');

/**
 * Arquiteto Estagiário — the general-purpose chat assistant. Deliberately a
 * DIFFERENT model from Astra (premium floor-plan analysis) and Terra (silent
 * furniture-detection vision): a conversational assistant has different
 * latency/cost needs and must be tunable on its own. Confirmed as a real
 * literal of the installed SDK's ChatModel union (resources/shared.d.ts).
 */
export const OPENAI_ARCHITECT_CHAT_MODEL = process.env.OPENAI_ARCHITECT_CHAT_MODEL || 'gpt-5.6-sol';
export const OPENAI_ARCHITECT_CHAT_TIMEOUT_MS = Number(process.env.OPENAI_ARCHITECT_CHAT_TIMEOUT_MS) || 120_000;
export const OPENAI_ARCHITECT_CHAT_MAX_OUTPUT_TOKENS = Number(process.env.OPENAI_ARCHITECT_CHAT_MAX_OUTPUT_TOKENS) || 2048;

/**
 * Audio attachments are never sent to the chat model directly: they are
 * transcribed first (a real, current literal of the SDK's AudioModel union —
 * resources/audio/transcriptions.d.ts) and only the transcript text joins the
 * conversation. This keeps the chat model's input contract to text + images,
 * which every candidate chat model is confirmed to support.
 */
export const OPENAI_ARCHITECT_TRANSCRIBE_MODEL = process.env.OPENAI_ARCHITECT_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
export const OPENAI_ARCHITECT_TRANSCRIBE_TIMEOUT_MS = Number(process.env.OPENAI_ARCHITECT_TRANSCRIBE_TIMEOUT_MS) || 60_000;

/** USD per 1,000,000 tokens. No defaults: an unset price yields a null cost, never a guess. */
export const OPENAI_ARCHITECT_CHAT_INPUT_PRICE_PER_M = readPrice('OPENAI_ARCHITECT_CHAT_INPUT_PRICE_PER_M');
export const OPENAI_ARCHITECT_CHAT_CACHED_INPUT_PRICE_PER_M = readPrice('OPENAI_ARCHITECT_CHAT_CACHED_INPUT_PRICE_PER_M');
export const OPENAI_ARCHITECT_CHAT_OUTPUT_PRICE_PER_M = readPrice('OPENAI_ARCHITECT_CHAT_OUTPUT_PRICE_PER_M');
/** USD per minute of audio. No default: an unset price yields a null cost. */
export const OPENAI_ARCHITECT_TRANSCRIBE_PRICE_PER_MINUTE = readPrice('OPENAI_ARCHITECT_TRANSCRIBE_PRICE_PER_MINUTE');
