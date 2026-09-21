import { z } from 'zod';

/**
 * Two-stage validation for the SECOND, OpenAI-based suspicious-text
 * verification call (providers/openaiTextVerification.ts) — the same
 * structural/semantic split already applied to the furniture-detection
 * pipeline (lib/floorplanFurniture/openaiResponseSchema.ts), after the
 * 2026-09-19 real run hit the identical failure mode here: one degenerate
 * `boundingBoxes` entry (yMax <= yMin) made the WHOLE response fail Zod's
 * `safeParse`, discarding a perfectly usable `possuiTextoNovo`/`confianca`/
 * `justificativa` verdict and 3 other valid boxes, and aborting the job
 * with a generic error AFTER FLUX had already run (no charge, but wasted
 * work and a confusing "unknown error").
 *
 *  1. STRUCTURAL (Zod): only checks the top-level fields exist with the
 *     right types, and that each box has 4 numeric fields. Never inspects
 *     box geometry — a genuinely malformed response (wrong type, missing
 *     field) is the only thing that still throws here.
 *  2. SEMANTIC (filterTextVerificationBoxes, applied per-box after a
 *     successful parse): a degenerate/inverted or out-of-bounds box is
 *     discarded INDIVIDUALLY. `possuiTextoNovo`, `confianca`, `justificativa`,
 *     and every other valid box always survive.
 */

const TextVerificationBoxSchema = z.object({
  xMin: z.number(),
  yMin: z.number(),
  xMax: z.number(),
  yMax: z.number(),
});

export const TextVerificationResponseSchema = z
  .object({
    possuiTextoNovo: z.boolean(),
    quantidade: z.number().int().min(0),
    boundingBoxes: z.array(TextVerificationBoxSchema),
    confianca: z.number().min(0).max(1),
    justificativa: z.string().min(1, 'justificativa must not be empty'),
  })
  .refine((r) => !r.possuiTextoNovo || r.quantidade > 0, {
    message: 'possuiTextoNovo=true requires quantidade > 0',
  });

export type TextVerificationStructuralParsed = z.infer<typeof TextVerificationResponseSchema>;

function parseJson(outputText: string): unknown {
  try {
    return JSON.parse(outputText);
  } catch (err) {
    throw new Error(`OpenAI text-verification response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// --- Semantic plausibility (per-box, never fails the whole response) ---

export type TextBoxDiscardReasonCode = 'degenerate_dimensions' | 'out_of_bounds';

/** Never includes image data, the prompt, or any secret — just computed numbers and a fixed reason code, safe to log/persist for diagnostics. */
export interface DiscardedTextBox {
  index: number;
  reasonCode: TextBoxDiscardReasonCode;
  reason: string;
  widthPx: number;
  heightPx: number;
}

export interface TextBoxFilterMetrics {
  totalReceived: number;
  totalAccepted: number;
  totalDiscarded: number;
  discardReasonsGrouped: Partial<Record<TextBoxDiscardReasonCode, number>>;
}

interface BoxLike {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

type BoxVerdict = { ok: true } | { ok: false; code: TextBoxDiscardReasonCode; reason: string };

function evaluateTextBoxPlausibility(box: BoxLike, imageWidth: number, imageHeight: number): BoxVerdict {
  const widthPx = box.xMax - box.xMin;
  const heightPx = box.yMax - box.yMin;

  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
    return { ok: false, code: 'degenerate_dimensions', reason: `dimensões não positivas ou invertidas (${widthPx.toFixed(1)}x${heightPx.toFixed(1)}px)` };
  }
  if (box.xMin < 0 || box.yMin < 0 || box.xMax > imageWidth || box.yMax > imageHeight) {
    return { ok: false, code: 'out_of_bounds', reason: `caixa fora dos limites da imagem (${imageWidth}x${imageHeight}px)` };
  }
  return { ok: true };
}

export interface TextVerificationBoxFilterResult {
  accepted: BoxLike[];
  discarded: DiscardedTextBox[];
  metrics: TextBoxFilterMetrics;
}

/**
 * Filters the parsed `boundingBoxes` array individually. `imageWidth`/
 * `imageHeight` are the dimensions of the SECOND (generated/result) image
 * the boxes are described relative to — see providers/openaiTextVerification.ts's
 * prompt, which explicitly instructs the model to report coordinates
 * relative to that image.
 */
export function filterTextVerificationBoxes(boxes: BoxLike[], imageWidth: number, imageHeight: number): TextVerificationBoxFilterResult {
  const accepted: BoxLike[] = [];
  const discarded: DiscardedTextBox[] = [];

  boxes.forEach((box, index) => {
    const verdict = evaluateTextBoxPlausibility(box, imageWidth, imageHeight);
    const widthPx = box.xMax - box.xMin;
    const heightPx = box.yMax - box.yMin;
    if (!verdict.ok) {
      discarded.push({ index, reasonCode: verdict.code, reason: verdict.reason, widthPx, heightPx });
      return;
    }
    accepted.push(box);
  });

  const discardReasonsGrouped: Partial<Record<TextBoxDiscardReasonCode, number>> = {};
  for (const d of discarded) {
    discardReasonsGrouped[d.reasonCode] = (discardReasonsGrouped[d.reasonCode] ?? 0) + 1;
  }

  return {
    accepted,
    discarded,
    metrics: { totalReceived: boxes.length, totalAccepted: accepted.length, totalDiscarded: discarded.length, discardReasonsGrouped },
  };
}

export interface ParsedAndFilteredTextVerification {
  possuiTextoNovo: boolean;
  quantidade: number;
  confianca: number;
  justificativa: string;
  boundingBoxes: BoxLike[];
  discardedBoxes: DiscardedTextBox[];
  boxMetrics: TextBoxFilterMetrics;
}

/**
 * Throws a plain Error ONLY for a genuine structural failure (malformed
 * JSON, wrong types, missing required top-level fields) — never for an
 * individually-implausible box, which is filtered out below instead.
 * providers/openaiTextVerification.ts wraps this throw into
 * AppError('VALIDATION_ERROR', ...).
 */
export function parseTextVerificationResponse(outputText: string, imageWidth: number, imageHeight: number): ParsedAndFilteredTextVerification {
  const parsed = parseJson(outputText);
  const result = TextVerificationResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`OpenAI text-verification response failed schema validation: ${result.error.message}`);
  }
  const boxFilter = filterTextVerificationBoxes(result.data.boundingBoxes, imageWidth, imageHeight);
  return {
    possuiTextoNovo: result.data.possuiTextoNovo,
    quantidade: result.data.quantidade,
    confianca: result.data.confianca,
    justificativa: result.data.justificativa,
    boundingBoxes: boxFilter.accepted,
    discardedBoxes: boxFilter.discarded,
    boxMetrics: boxFilter.metrics,
  };
}

// --- Strict JSON Schema (request-side) ---
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

export const TEXT_VERIFICATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    possuiTextoNovo: { type: 'boolean' },
    quantidade: { type: 'number' },
    boundingBoxes: { type: 'array', items: BOX_JSON_SCHEMA },
    confianca: { type: 'number' },
    justificativa: { type: 'string' },
  },
  required: ['possuiTextoNovo', 'quantidade', 'boundingBoxes', 'confianca', 'justificativa'],
  additionalProperties: false,
} as const;
