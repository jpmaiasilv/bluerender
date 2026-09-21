import { GoogleGenAI } from '@google/genai';
import { geminiLogger } from '../lib/logger';
import { AppError } from '../lib/errors';
import {
  GEMINI_OVERVIEW_JSON_SCHEMA,
  GEMINI_TILE_JSON_SCHEMA,
  parseGeminiOverviewResponse,
  parseGeminiTileResponse,
} from '../lib/floorplanFurniture/geminiResponseSchema';
import { RawGeminiDetection } from '../lib/floorplanFurniture/types';
import {
  assertValidThinkingLevel,
  GEMINI_VISION_MAX_OUTPUT_TOKENS,
  GEMINI_VISION_MODEL,
  GEMINI_VISION_THINKING_LEVEL,
  GEMINI_VISION_TIMEOUT_MS,
} from '../config/geminiVisionEngine';

/**
 * Gemini semantic-detection integration — furniture/room RECOGNITION only.
 * Deliberately its own module, never imported by providers/bfl.ts or
 * providers/bflFill.ts and never importing them either: this is read-only
 * vision analysis, not an image-generation provider, and it must stay free
 * to change independently of the paid FLUX.1 Fill pipeline. Nothing in this
 * file calls debit(), creates a job, or touches the credit wallet — see
 * scripts/inspect-gemini-furniture.ts for how it's actually invoked.
 *
 * Two-phase design (see detectFurnitureObjects' `variant` param): an
 * "overview" pass (boxes only, no segmentation) is cheap enough to cover
 * the whole plan quickly, while a "tile" pass (boxes + segmentation
 * polygon) only ever covers one zoomed-in section at a time. The first
 * real attempt asked for full segmentation on the whole-plan overview in
 * one call and it timed out — this split exists specifically to fix that,
 * not just to raise the timeout on the same heavy request.
 *
 * No `tools` field is ever sent (no Google Search grounding, no other
 * tool) — every call is pure image-in/JSON-out classification.
 * No automatic retry on failure and no fallback to a different (e.g. paid)
 * model: exactly one HTTP call per detectFurnitureObjects() invocation.
 */

let client: GoogleGenAI | null = null;
let callCount = 0;

/** Reads GEMINI_API_KEY only from process.env, only at call time — never logged, never included in any error message, response, or artifact file written by this pipeline. */
function getClient(): GoogleGenAI {
  if (client) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AppError(
      'INVALID_API_KEY',
      'GEMINI_API_KEY is not configured on the server.',
      'Add GEMINI_API_KEY to backend/.env and restart the server.',
      500
    );
  }
  client = new GoogleGenAI({ apiKey });
  return client;
}

/** Exact count of real network calls made through this module in the current process — the single source of truth scripts/inspect-gemini-furniture.ts reports, rather than a separately-maintained counter that could drift. */
export function getGeminiCallCount(): number {
  return callCount;
}

export function resetGeminiCallCountForTests(): void {
  callCount = 0;
}

export type GeminiVisionVariant = 'overview' | 'tile';

export interface GeminiVisionDetectParams {
  variant: GeminiVisionVariant;
  imageBase64: string;
  mimeType: 'image/png' | 'image/jpeg';
  /** Extra context appended to the base prompt — e.g. "This is a zoomed-in section of a larger floor plan; only report objects that are more than half-visible in this section." */
  promptContext?: string;
}

export interface GeminiVisionDetectResult {
  detections: RawGeminiDetection[];
  /** Raw response text, kept only for artifact/debug files — the caller is responsible for never writing the request (which never contains the key anyway) alongside it in a way that could be confused with credentials. */
  rawOutputText: string;
  /** Wall-clock time for this one request — logged/reported, no secret ever included alongside it. */
  elapsedMs: number;
}

const SHARED_INTRO = `You are analyzing a black-and-white architectural floor plan drawing (not a photo).
Identify every room and every piece of furniture, fixture, appliance, staircase or vehicle drawn in the plan, including:
rooms/compartments (comodo), beds (cama), sofas (sofa), tables (mesa), chairs (cadeira), cabinets/wardrobes (armario),
countertops (bancada), sinks (pia), toilets (vaso_sanitario), showers (chuveiro), appliances such as stoves/fridges/washers (eletrodomestico),
staircases (escada), vehicles such as cars (veiculo), and any other recognizable furniture (mobiliario_outro) or architectural object (objeto_outro).

Do NOT report walls, doors, windows, columns, dimension lines/numbers, or text labels as objects — only rooms and movable/replaceable
furniture, fixtures and vehicles.

For every object, give:
- "category": one of the fixed category codes above.
- "label": a short descriptive label, in Portuguese (e.g. "cama de casal", "sofá de 3 lugares").
- "roomType": your best guess of which room/compartment this object is in, in Portuguese (e.g. "quarto", "banheiro", "cozinha", "garagem", "área externa"), or null if you cannot tell. For a "comodo" object itself, this is that room's own type.
- "confidence": your confidence this object is correctly identified and located, from 0 to 1.
- "box_2d": the bounding box as [ymin, xmin, ymax, xmax], normalized to 0-1000 relative to the image you were given.`;

const OVERVIEW_SUFFIX = `
This is a FIRST, GENERAL PASS over the whole floor plan — its only purpose is to locate rooms and objects so a second, detailed pass can zoom into each section. Do NOT produce a segmentation polygon/mask in this pass — bounding boxes only. Give a complete pass over the whole image.

Output a JSON object with a single key "objects" containing the list described above (each item has category, label, roomType, confidence, box_2d — no "mask" field). Do not include any object you are not reasonably confident about.`;

const TILE_SUFFIX = `
For every object also give:
- "mask": the object's outline as a polygon of [x, y] points normalized to 0-1000 relative to THIS image, or null if you cannot give a clean polygon for it.

This is a DETAILED, ZOOMED-IN pass over one section of a larger floor plan — analyze ONLY the objects visible in this specific image, do not attempt to describe the plan as a whole.

Output a JSON object with a single key "objects" containing the list described above. Do not include any object you are not reasonably confident about.`;

function buildPrompt(variant: GeminiVisionVariant, promptContext?: string): string {
  const suffix = variant === 'overview' ? OVERVIEW_SUFFIX : TILE_SUFFIX;
  const base = `${SHARED_INTRO}\n${suffix}`;
  return promptContext ? `${base}\n\n${promptContext}` : base;
}

function classifyNetworkError(err: unknown): { kind: string; message: string } {
  const messages: string[] = [];
  let code: string | undefined;
  let name: string | undefined;
  let cur: unknown = err;
  let depth = 0;
  while (cur && depth < 5) {
    if (cur instanceof Error) {
      messages.push(cur.message);
      const errCode = (cur as NodeJS.ErrnoException).code;
      if (!code && typeof errCode === 'string') code = errCode;
      if (!name) name = cur.name;
      cur = (cur as { cause?: unknown }).cause;
    } else {
      messages.push(String(cur));
      cur = undefined;
    }
    depth++;
  }
  const message = messages.filter(Boolean).join(' <- ') || 'Unknown error';
  if (name === 'AbortError' || name === 'TimeoutError' || /timed? ?out/i.test(message)) return { kind: 'TIMEOUT', message };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { kind: 'DNS_RESOLUTION_FAILED', message };
  if (code === 'ECONNREFUSED') return { kind: 'CONNECTION_REFUSED', message };
  if (code === 'ECONNRESET') return { kind: 'CONNECTION_RESET', message };
  return { kind: code || name || 'NETWORK_ERROR', message };
}

/**
 * Truncates and strips anything resembling a base64 blob (>=80 contiguous
 * base64-alphabet characters — long enough that no ordinary word/identifier
 * matches it, but short enough to catch even a partially-echoed image)
 * before any HTTP error status/body is logged or stored. Defense in depth:
 * the SDK's own error body is not expected to ever contain the request
 * image or API key, but nothing here trusts that assumption blindly.
 */
function sanitizeForLogging(text: string, maxLength = 4000): string {
  const truncated = text.length > maxLength ? `${text.slice(0, maxLength)}…[truncated]` : text;
  return truncated.replace(/[A-Za-z0-9+/]{80,}={0,2}/g, '[BASE64_REDACTED]');
}

interface SdkErrorShape {
  status?: number;
  body?: unknown;
  error?: unknown;
}

/** Maps a thrown SDK error to a clear AppError, explicitly recognizing free-tier exhaustion/unavailability rather than letting it look like a generic failure — per requirement, this must STOP and inform, never fall back to a paid model or silently retry. Logs ONLY the HTTP status, elapsed time, and a sanitized error body — never headers, never the request (so never the API key or the base64 image). */
function classifySdkError(err: unknown, elapsedMs: number): AppError {
  const shaped = err as SdkErrorShape;
  const status = shaped?.status;
  const rawMessage = err instanceof Error ? err.message : String(err);
  const bodyText = shaped?.body !== undefined ? sanitizeForLogging(typeof shaped.body === 'string' ? shaped.body : JSON.stringify(shaped.body)) : undefined;
  const sanitizedMessage = sanitizeForLogging(rawMessage);
  const isTimeout = /timed? ?out/i.test(rawMessage);

  geminiLogger.error('Gemini HTTP error', { model: GEMINI_VISION_MODEL, status: status ?? 'n/a', elapsedMs, body: bodyText ?? '(no body)' });

  const details = `${bodyText ? `${sanitizedMessage} | body: ${bodyText}` : sanitizedMessage} | elapsedMs: ${elapsedMs}`;

  if (isTimeout) {
    return new AppError('GENERATION_TIMEOUT', `Gemini request timed out after ${elapsedMs}ms (limit ${GEMINI_VISION_TIMEOUT_MS}ms). No automatic retry.`, details, 504);
  }

  const isQuotaOrFreeTierIssue =
    status === 429 ||
    /RESOURCE_EXHAUSTED/i.test(rawMessage) ||
    /quota/i.test(rawMessage) ||
    /free.?tier/i.test(rawMessage);

  if (isQuotaOrFreeTierIssue) {
    return new AppError(
      'PROVIDER_UNAVAILABLE',
      'Gemini Free Tier is currently unavailable (rate limit or quota exhausted). Stopping — no automatic retry and no fallback to a paid model.',
      details,
      429
    );
  }
  if (status === 401 || status === 403 || /API key/i.test(rawMessage)) {
    return new AppError('INVALID_API_KEY', 'The Gemini API key was rejected.', details, 401);
  }
  if (status === 400 || status === 422) {
    return new AppError('VALIDATION_ERROR', `Gemini rejected the request (HTTP ${status}).`, details, status);
  }
  if (typeof status === 'number' && status >= 500) {
    return new AppError('PROVIDER_UNAVAILABLE', 'Gemini is currently unavailable. Please try again later.', details, 502);
  }
  return new AppError('UNKNOWN_ERROR', 'The Gemini request failed.', details, 500);
}

/**
 * Exactly one Gemini API call per invocation. No retry, no fallback model.
 * Throws AppError on any failure (network, HTTP, schema validation) — the
 * caller decides whether/how to proceed (e.g. skip this crop).
 */
export async function detectFurnitureObjects(params: GeminiVisionDetectParams): Promise<GeminiVisionDetectResult> {
  // Checked BEFORE getClient()/callCount even runs — an invalid configured
  // value must never count as an attempted call or reach the network.
  assertValidThinkingLevel(GEMINI_VISION_THINKING_LEVEL);

  const ai = getClient();
  const prompt = buildPrompt(params.variant, params.promptContext);
  const schema = params.variant === 'overview' ? GEMINI_OVERVIEW_JSON_SCHEMA : GEMINI_TILE_JSON_SCHEMA;

  let outputText: string | undefined;
  const startedAt = Date.now();
  try {
    callCount += 1;
    const interaction = await ai.interactions.create(
      {
        model: GEMINI_VISION_MODEL,
        input: [
          { type: 'text', text: prompt },
          { type: 'image', data: params.imageBase64, mime_type: params.mimeType },
        ],
        // No `tools` field — grounding/Google Search stays off.
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema,
        },
        generation_config: {
          thinking_level: GEMINI_VISION_THINKING_LEVEL,
          max_output_tokens: GEMINI_VISION_MAX_OUTPUT_TOKENS,
        },
      },
      // maxRetries: 0 is explicit and deliberate — the SDK may otherwise
      // retry transient failures on its own, which would violate the
      // requirement that a failed Gemini call never re-executes
      // automatically. Every retry the pipeline makes must be a distinct,
      // caller-initiated call (e.g. the next tile), never a hidden one.
      { timeout: GEMINI_VISION_TIMEOUT_MS, maxRetries: 0 }
    );
    outputText = interaction.output_text ?? undefined;
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    if (err instanceof AppError) throw err;
    // classifySdkError does its own safe (status + elapsed time + sanitized
    // body only) logging below — classifyNetworkError is used only for the
    // pure connectivity-failure case (DNS/refused/reset), which has no HTTP
    // status/body to log in the first place.
    const shaped = err as { status?: number };
    if (typeof shaped?.status !== 'number') {
      const classified = classifyNetworkError(err);
      geminiLogger.error('Gemini network error (no HTTP response received)', { model: GEMINI_VISION_MODEL, errorKind: classified.kind, elapsedMs });
    }
    throw classifySdkError(err, elapsedMs);
  }

  const elapsedMs = Date.now() - startedAt;

  if (!outputText) {
    throw new AppError('UNKNOWN_ERROR', 'Gemini returned an empty response.', `elapsedMs: ${elapsedMs}`, 502);
  }

  if (params.variant === 'overview') {
    const parsed = parseGeminiOverviewResponse(outputText);
    return {
      detections: parsed.objects.map((o) => ({
        category: o.category,
        label: o.label,
        roomType: o.roomType,
        confidence: o.confidence,
        box_2d: o.box_2d as [number, number, number, number],
        mask: null,
      })),
      rawOutputText: outputText,
      elapsedMs,
    };
  }

  const parsed = parseGeminiTileResponse(outputText);
  return {
    detections: parsed.objects.map((o) => ({
      category: o.category,
      label: o.label,
      roomType: o.roomType,
      confidence: o.confidence,
      box_2d: o.box_2d as [number, number, number, number],
      mask: o.mask as [number, number][] | null,
    })),
    rawOutputText: outputText,
    elapsedMs,
  };
}
