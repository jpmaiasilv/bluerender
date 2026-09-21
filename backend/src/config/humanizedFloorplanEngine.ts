/**
 * Pricing for Planta Humanizada's FLUX.1 Fill pipeline — deliberately its
 * own, separate config module (not config/engines.ts or config/plantaEngines.ts):
 * Fill has no Fast/Pro/Ultra tiers, it's a single model, and it must never
 * be confused with the FLUX.2 pricing table the other tools rely on.
 *
 * Three DIFFERENT numbers, never conflated:
 *  - PROVIDER_COST_USD / PROVIDER_CREDITS: what BFL itself charges this
 *    app's BFL account, per BFL's own published pricing (docs.bfl.ml/quick_start/pricing)
 *    — informational only, never sent to or read from the frontend.
 *  - WALLET_DEBIT_CREDITS: what this app charges the USER's internal Blue
 *    Render wallet. This is the SINGLE shared source of truth for the cost
 *    shown anywhere in the product: the frontend never hardcodes this
 *    number, it fetches it from GET /api/generate-humanized-floorplan/config
 *    (see routes/generateHumanizedFloorplan.ts), which reads this constant.
 *
 * Set to 2 credits (2026-09-19): the flat price for ONE humanized floor
 * plan generation, shared by the primary (simple) flow and the dormant
 * advanced pipeline. This constant is the only place the number lives —
 * the frontend always receives it from GET .../config, never hardcodes it.
 */
export const HUMANIZED_FLOORPLAN_PROVIDER_COST_USD = 0.05;
export const HUMANIZED_FLOORPLAN_PROVIDER_CREDITS = 5;
/** Cost of the STANDARD (Blue Render) mode — the original, unchanged flow. */
export const STANDARD_HUMANIZED_FLOORPLAN_COST = 2;
/** Cost of the ASTRA mode (GPT-6 Astra analysis + Sunburst generation + verification + at most one automatic correction, all included). */
export const ASTRA_HUMANIZED_FLOORPLAN_COST = 10;

export const HUMANIZED_FLOORPLAN_GENERATION_MODES = ['standard', 'astra'] as const;
export type HumanizedFloorplanGenerationMode = (typeof HUMANIZED_FLOORPLAN_GENERATION_MODES)[number];
export const DEFAULT_HUMANIZED_FLOORPLAN_MODE: HumanizedFloorplanGenerationMode = 'standard';

/** The ONLY place a mode is turned into a price. The client never sends a cost. */
export const HUMANIZED_FLOORPLAN_MODE_COSTS: Record<HumanizedFloorplanGenerationMode, number> = {
  standard: STANDARD_HUMANIZED_FLOORPLAN_COST,
  astra: ASTRA_HUMANIZED_FLOORPLAN_COST,
};

/** Kept for the dormant advanced pipeline and existing callers: the standard-mode price. */
export const HUMANIZED_FLOORPLAN_WALLET_DEBIT_CREDITS = STANDARD_HUMANIZED_FLOORPLAN_COST;

export const HUMANIZED_FLOORPLAN_DEFAULT_STEPS = 50;
export const HUMANIZED_FLOORPLAN_DEFAULT_GUIDANCE = 30;
export const HUMANIZED_FLOORPLAN_DEFAULT_SAFETY_MARGIN_PX = 6;

/** How much the model's output may drift inside protected regions (0-1) before the whole result is rejected — same knob floorplanValidation.ts's DEFAULT_DEVIATION_TOLERANCE exposes, re-exported here so the route's config imports all come from one place. */
export const HUMANIZED_FLOORPLAN_DEVIATION_TOLERANCE = 0.18;

const MIN_USEFUL_AREA_MARGIN_PX = 0;
const MAX_USEFUL_AREA_MARGIN_PX = 500;
const DEFAULT_USEFUL_AREA_MARGIN_PX = 60;

/**
 * Same fail-fast validation pattern used elsewhere in this pipeline (e.g.
 * resolveOpenAiVisionTimeoutMs) — an out-of-range value refuses to start
 * rather than silently clamping.
 */
export function resolveUsefulAreaMarginPx(raw: string | undefined): number {
  if (!raw) return DEFAULT_USEFUL_AREA_MARGIN_PX;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_USEFUL_AREA_MARGIN_PX || value > MAX_USEFUL_AREA_MARGIN_PX) {
    throw new Error(`Invalid HUMANIZED_FLOORPLAN_USEFUL_AREA_MARGIN_PX "${raw}" — must be a number between ${MIN_USEFUL_AREA_MARGIN_PX} and ${MAX_USEFUL_AREA_MARGIN_PX}.`);
  }
  return value;
}

/**
 * Safety margin (in pixels, on the ORIGINAL image) added around the
 * detected drawn-content bounding box before that region is sent to
 * FLUX.1 Fill — see lib/floorplanMask/usefulAreaCrop.ts. Deliberately its
 * own constant (not a reuse of config/geminiVisionEngine.ts's
 * GEMINI_VISION_USEFUL_AREA_MARGIN_PX, which serves a different purpose —
 * giving the vision MODEL context — and lives in a module this fix must
 * not touch or depend on).
 */
export const HUMANIZED_FLOORPLAN_USEFUL_AREA_MARGIN_PX: number = resolveUsefulAreaMarginPx(process.env.HUMANIZED_FLOORPLAN_USEFUL_AREA_MARGIN_PX);

const MIN_TEXT_GROUP_MARGIN_PX = 0;
const MAX_TEXT_GROUP_MARGIN_PX = 100;
const DEFAULT_TEXT_GROUP_MARGIN_PX = 10;

export function resolveTextGroupMarginPx(raw: string | undefined): number {
  if (!raw) return DEFAULT_TEXT_GROUP_MARGIN_PX;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_TEXT_GROUP_MARGIN_PX || value > MAX_TEXT_GROUP_MARGIN_PX) {
    throw new Error(`Invalid HUMANIZED_FLOORPLAN_TEXT_GROUP_MARGIN_PX "${raw}" — must be a number between ${MIN_TEXT_GROUP_MARGIN_PX} and ${MAX_TEXT_GROUP_MARGIN_PX}.`);
  }
  return value;
}

/**
 * Safety margin (ORIGINAL-image pixels) added around each GROUPED text/label
 * region (see lib/floorplanMask/textGrouping.ts) before it's added to the
 * protected mask — separate from HUMANIZED_FLOORPLAN_DEFAULT_SAFETY_MARGIN_PX,
 * which applies a single blanket dilation to the whole combined structure
 * mask (walls+furniture+text+arcs) afterward. This one exists specifically
 * so text/label protection can be tuned independently of wall/furniture
 * protection, per requirement: "amplie suas caixas com margem de segurança
 * configurável."
 */
export const HUMANIZED_FLOORPLAN_TEXT_GROUP_MARGIN_PX: number = resolveTextGroupMarginPx(process.env.HUMANIZED_FLOORPLAN_TEXT_GROUP_MARGIN_PX);

const MIN_TEXT_RESTORATION_MARGIN_PX = 0;
const MAX_TEXT_RESTORATION_MARGIN_PX = 50;
const DEFAULT_TEXT_RESTORATION_MARGIN_PX = 6;

export function resolveTextRestorationMarginPx(raw: string | undefined): number {
  if (!raw) return DEFAULT_TEXT_RESTORATION_MARGIN_PX;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_TEXT_RESTORATION_MARGIN_PX || value > MAX_TEXT_RESTORATION_MARGIN_PX) {
    throw new Error(`Invalid HUMANIZED_FLOORPLAN_TEXT_RESTORATION_MARGIN_PX "${raw}" — must be a number between ${MIN_TEXT_RESTORATION_MARGIN_PX} and ${MAX_TEXT_RESTORATION_MARGIN_PX}.`);
  }
  return value;
}

/**
 * Small margin (ORIGINAL-image pixels) added around a CONFIRMED new-text
 * bounding box (from providers/openaiTextVerification.ts) before the local,
 * surgical, post-FLUX restoration in lib/floorplanMask/textCorrection.ts —
 * deliberately smaller than HUMANIZED_FLOORPLAN_TEXT_GROUP_MARGIN_PX (that
 * one protects PRE-existing labels broadly; this one patches a SPECIFIC
 * confirmed hallucination as tightly as safely possible).
 */
export const HUMANIZED_FLOORPLAN_TEXT_RESTORATION_MARGIN_PX: number = resolveTextRestorationMarginPx(process.env.HUMANIZED_FLOORPLAN_TEXT_RESTORATION_MARGIN_PX);

const MIN_TEXT_UNIFORMITY_STDDEV = 1;
const MAX_TEXT_UNIFORMITY_STDDEV = 80;
const DEFAULT_TEXT_UNIFORMITY_STDDEV = 14;

export function resolveTextUniformityStdDevThreshold(raw: string | undefined): number {
  if (!raw) return DEFAULT_TEXT_UNIFORMITY_STDDEV;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_TEXT_UNIFORMITY_STDDEV || value > MAX_TEXT_UNIFORMITY_STDDEV) {
    throw new Error(`Invalid HUMANIZED_FLOORPLAN_TEXT_UNIFORMITY_STDDEV "${raw}" — must be a number between ${MIN_TEXT_UNIFORMITY_STDDEV} and ${MAX_TEXT_UNIFORMITY_STDDEV}.`);
  }
  return value;
}

/**
 * Grayscale standard-deviation threshold (0-255 scale) used to decide
 * whether the ORIGINAL content under a confirmed new-text box is "blank/
 * uniform enough" to safely patch with a local pixel restoration (a plain
 * white/flat background) versus "textured/relevant" (floor pattern,
 * furniture, vegetation, or any other content with real detail) where a
 * local patch could look worse than the hallucination itself — requirement:
 * "se estiver sobre piso, textura, móvel, vegetação ou região relevante,
 * rejeite." The SAME threshold is reused, symmetrically, to check the
 * corrected region afterward for a visible seam/smudge (requirement: "a
 * correção não [pode] criar manchas visíveis").
 */
export const HUMANIZED_FLOORPLAN_TEXT_UNIFORMITY_STDDEV: number = resolveTextUniformityStdDevThreshold(process.env.HUMANIZED_FLOORPLAN_TEXT_UNIFORMITY_STDDEV);
