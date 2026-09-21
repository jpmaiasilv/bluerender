import crypto from 'node:crypto';
import OpenAI from 'openai';
import { openaiLogger } from '../lib/logger';
import { AppError } from '../lib/errors';
import { classifyOpenAiError } from './openaiVision';
import { ParsedAndFilteredTextVerification, parseTextVerificationResponse, TEXT_VERIFICATION_JSON_SCHEMA } from '../lib/floorplanMask/textVerificationSchema';
import { saveTextVerificationDiagnostics, startTextVerificationDiagnosticsCleanup } from '../storage/textVerificationDiagnosticsStore';
import { OPENAI_VISION_DETAIL, OPENAI_VISION_MAX_OUTPUT_TOKENS, OPENAI_VISION_MODEL, OPENAI_VISION_TIMEOUT_MS } from '../config/openaiModels';

/**
 * The SECOND, structured OpenAI check in the suspicious-text pipeline — the
 * only thing allowed to turn floorplanValidation.ts's cheap OpenCV heuristic
 * (proven to confuse furniture/rug/texture edges with text) into an actual
 * rejection (see decideFinalAcceptance in floorplanValidation.ts). Deliberately
 * its own module: a different call shape (TWO images, not one crop) and a
 * different purpose (confirm/deny a candidate, not detect furniture) than
 * providers/openaiVision.ts, even though it reuses that module's client
 * setup pattern and error classification (`classifyOpenAiError`, imported —
 * not duplicated) for consistency.
 *
 * Same billing-safety contract as the rest of this pipeline: exactly one
 * HTTP call per invocation, no retry, no fallback model, `store: false`,
 * never logs the API key or the base64 image bytes. A thrown AppError here
 * must reach the caller unmodified so the job ends in error (no charge, no
 * silent delivery) — see requirement: "Se a verificação falhar tecnicamente,
 * não cobre e não entregue silenciosamente."
 *
 * Structural vs. semantic box validation (2026-09-19 fix, mirroring the
 * furniture-detection pipeline's identical fix earlier the same day): a
 * single degenerate/out-of-bounds `boundingBoxes` entry used to fail Zod's
 * `safeParse` for the WHOLE response, discarding a perfectly usable
 * possuiTextoNovo/confianca/justificativa verdict along with any other valid
 * box — see textVerificationSchema.ts's filterTextVerificationBoxes for the
 * per-box fix; this file just wires it up and classifies a genuine
 * structural residual failure as VALIDATION_ERROR instead of UNKNOWN_ERROR.
 */

let client: OpenAI | null = null;
let callCount = 0;

export function getTextVerificationCallCount(): number {
  return callCount;
}

export function resetTextVerificationCallCountForTests(): void {
  callCount = 0;
}

function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AppError(
      'INVALID_API_KEY',
      'OPENAI_API_KEY is not configured on the server.',
      'Add OPENAI_API_KEY to backend/.env and restart the server.',
      500
    );
  }
  client = new OpenAI({ apiKey, timeout: OPENAI_VISION_TIMEOUT_MS, maxRetries: 0 });
  return client;
}

/** Truncates and strips anything resembling a base64 blob before any error detail is stored/thrown — same defense-in-depth pattern as providers/openaiVision.ts's sanitizeForLogging. */
function sanitizeForLogging(text: string, maxLength = 2000): string {
  const truncated = text.length > maxLength ? `${text.slice(0, maxLength)}…[truncated]` : text;
  return truncated.replace(/[A-Za-z0-9+/]{80,}={0,2}/g, '[BASE64_REDACTED]');
}

export interface TextVerificationParams {
  originalImageBase64: string;
  originalMimeType: 'image/png' | 'image/jpeg';
  /** The generated result is always re-encoded to PNG by floorplanValidation.ts's pipeline before this call — kept as an explicit field (not assumed) so this function never silently guesses a format. */
  resultImageBase64: string;
  resultMimeType: 'image/png' | 'image/jpeg';
  /** Exact pixel dimensions of the SECOND (result) image — the model is asked to report boundingBoxes relative to it, and these are the bounds the semantic filter checks them against. */
  resultWidth: number;
  resultHeight: number;
  /** Optional hint built from the heuristic's own candidate boxes/count — helps the model focus, never trusted as ground truth. */
  candidateHint?: string;
  /** Groups this call's private diagnostics (accepted/discarded boxes — see storage/textVerificationDiagnosticsStore.ts) under this id. Callers with a real jobId (routes/generateHumanizedFloorplan.ts) should pass it; a fresh id is generated when omitted (e.g. standalone scripts). */
  diagnosticsId?: string;
}

export interface TextVerificationCallResult {
  result: ParsedAndFilteredTextVerification;
  rawOutputText: string;
  elapsedMs: number;
  requestId: string | null;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
}

const PROMPT = `You are comparing two images of the SAME architectural floor plan, viewed top-down: the ORIGINAL (first image) and a GENERATED/humanized version (second image) produced by an AI inpainting model.

Your ONLY job: determine whether the generated image contains text, letters, numbers, labels, or dimension-style annotations that are NEW or CORRUPTED compared to the original — i.e. text-like marks that were NOT already legible in the original image, or original text that was garbled/duplicated/distorted.

Do NOT flag:
- Furniture, rugs, decorative objects, or their textures/patterns/edges — even if they have sharp contrast or fine detail, they are not text.
- Text that already existed in the original image and was faithfully reproduced (even if styled slightly differently).
- Normal architectural linework (walls, doors, windows, dimension lines without readable digits).

Only flag actual new or corrupted text/characters. If you are not looking at real alphanumeric characters, do not report them as text.

Return ONLY the structured JSON:
- possuiTextoNovo: true only if you are confident there is genuinely new or corrupted text.
- quantidade: how many distinct new/corrupted text regions you found (0 if possuiTextoNovo is false).
- boundingBoxes: pixel coordinates (relative to the SECOND/generated image) of each one you found.
- confianca: your confidence in this specific verdict, 0 to 1.
- justificativa: one short sentence explaining your verdict.`;

/** Exactly one OpenAI Responses API call. No retry, no fallback model. Throws AppError on any failure — the caller (the route) must let this propagate so the job ends in error, uncharged. */
export async function verifySuspiciousText(params: TextVerificationParams): Promise<TextVerificationCallResult> {
  startTextVerificationDiagnosticsCleanup();
  const diagnosticsId = params.diagnosticsId ?? crypto.randomUUID();

  const client = getClient();
  const originalDataUrl = `data:${params.originalMimeType};base64,${params.originalImageBase64}`;
  const resultDataUrl = `data:${params.resultMimeType};base64,${params.resultImageBase64}`;
  const prompt = params.candidateHint ? `${PROMPT}\n\nA cheap automated heuristic flagged: ${params.candidateHint}. Use this only as a hint of where to look — verify independently, it is known to produce false positives on furniture/texture.` : PROMPT;

  const startedAt = Date.now();
  let response: OpenAI.Responses.Response;
  try {
    callCount += 1;
    response = await client.responses.create(
      {
        model: OPENAI_VISION_MODEL,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_text', text: 'ORIGINAL image:' },
              { type: 'input_image', image_url: originalDataUrl, detail: OPENAI_VISION_DETAIL },
              { type: 'input_text', text: 'GENERATED image:' },
              { type: 'input_image', image_url: resultDataUrl, detail: OPENAI_VISION_DETAIL },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'floorplan_text_verification',
            schema: TEXT_VERIFICATION_JSON_SCHEMA,
            strict: true,
          },
        },
        max_output_tokens: OPENAI_VISION_MAX_OUTPUT_TOKENS,
        store: false,
      },
      { maxRetries: 0 }
    );
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    if (err instanceof AppError) throw err;
    throw classifyOpenAiError(err, elapsedMs);
  }

  const elapsedMs = Date.now() - startedAt;
  const outputText = response.output_text;

  if (!outputText) {
    throw new AppError('UNKNOWN_ERROR', 'OpenAI returned an empty response for text verification.', `requestId: ${response.id} | elapsedMs: ${elapsedMs}`, 502);
  }

  const usage = response.usage
    ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, totalTokens: response.usage.total_tokens }
    : null;

  // Success telemetry only (no key, no headers, no base64) — includes usage,
  // matching providers/openaiVision.ts's equivalent log line.
  openaiLogger.log('OpenAI text-verification call completed', { requestId: response.id, elapsedMs, usage });

  // Structural parse failures (malformed JSON, wrong types, missing fields)
  // are the ONLY thing that throws here — wrapped as VALIDATION_ERROR so it
  // never falls into a generic UNKNOWN_ERROR at the job level. A degenerate
  // individual box does NOT throw — it's filtered out inside
  // parseTextVerificationResponse and never reaches this catch.
  let result: ParsedAndFilteredTextVerification;
  try {
    result = parseTextVerificationResponse(outputText, params.resultWidth, params.resultHeight);
  } catch (err) {
    throw new AppError(
      'VALIDATION_ERROR',
      'OpenAI text-verification response failed structural validation.',
      `${sanitizeForLogging(err instanceof Error ? err.message : String(err))} | requestId: ${response.id} | elapsedMs: ${elapsedMs}`,
      502
    );
  }

  saveTextVerificationDiagnostics(diagnosticsId, {
    imageWidth: params.resultWidth,
    imageHeight: params.resultHeight,
    possuiTextoNovo: result.possuiTextoNovo,
    quantidade: result.quantidade,
    confianca: result.confianca,
    justificativa: result.justificativa,
    acceptedBoxes: result.boundingBoxes,
    discardedBoxes: result.discardedBoxes,
    boxMetrics: result.boxMetrics,
    requestId: response.id,
    elapsedMs,
  });

  return { result, rawOutputText: outputText, elapsedMs, requestId: response.id, usage };
}
