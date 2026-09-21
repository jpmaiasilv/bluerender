import OpenAI from 'openai';
import { openaiLogger } from '../lib/logger';
import { AppError } from '../lib/errors';
import {
  OPENAI_OVERVIEW_JSON_SCHEMA,
  OPENAI_TILE_JSON_SCHEMA,
  parseOpenAIOverviewResponse,
  parseOpenAITileResponse,
} from '../lib/floorplanFurniture/openaiResponseSchema';
import { OpenAIVisionResult } from '../lib/floorplanFurniture/openaiTypes';
import {
  OPENAI_VISION_DETAIL,
  OPENAI_VISION_MAX_OUTPUT_TOKENS,
  OPENAI_VISION_MODEL,
  OPENAI_VISION_TIMEOUT_MS,
} from '../config/openaiModels';

/**
 * OpenAI semantic-detection integration — furniture/room RECOGNITION only.
 * Deliberately its own module, never imported by providers/bfl.ts,
 * providers/bflFill.ts, or providers/geminiVision.ts, and never importing
 * them either. Read-only vision analysis, not an image-generation provider
 * — nothing in this file calls debit(), creates a job, or touches the
 * credit wallet. See providers/openaiBlockImage.ts for the (not-yet-called)
 * block-image generator, kept in a fully separate file on purpose.
 *
 * Two-phase design mirrors the (currently inactive) Gemini pipeline: an
 * "overview" pass (boxes only) must succeed before any "tile" pass (boxes +
 * segmentation polygon) is attempted — enforced by the caller
 * (detectFloorplanFurnitureOpenAI.ts), not by this module.
 *
 * No `tools` field is ever sent — every call is pure image-in/JSON-out
 * classification, no web search, no file search, no other tool.
 * No automatic retry on failure and no fallback to a different (e.g. paid
 * image-generation) model: `maxRetries: 0` is passed explicitly to the SDK
 * (whose own docs note request timeouts are otherwise retried by default),
 * and this function makes exactly one HTTP call per invocation.
 */

let client: OpenAI | null = null;
let callCount = 0;

/** Reads OPENAI_API_KEY only from process.env, only at call time — never logged, never included in any error message, response, or artifact file written by this pipeline. Never sent to the frontend (this module only runs server-side). */
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

export function getOpenAiVisionCallCount(): number {
  return callCount;
}

export function resetOpenAiVisionCallCountForTests(): void {
  callCount = 0;
}

export type OpenAIVisionVariant = 'overview' | 'tile';

export interface OpenAIVisionDetectParams {
  variant: OpenAIVisionVariant;
  imageBase64: string;
  mimeType: 'image/png' | 'image/jpeg';
  /** The exact pixel dimensions of the image being sent — used both to build the request's data URL sanity and to bound the response schema's area-ratio validation contextually. */
  cropWidth: number;
  cropHeight: number;
  promptContext?: string;
}

export interface OpenAIVisionUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface OpenAIVisionDetectResult {
  result: OpenAIVisionResult;
  rawOutputText: string;
  elapsedMs: number;
  requestId: string | null;
  usage: OpenAIVisionUsage | null;
}

const SHARED_INTRO = `You are analyzing a black-and-white architectural floor plan drawing, viewed exactly from directly above (a straight top-down/plan view, not a perspective or isometric view). This is a technical drawing, not a photo.

Rules:
- Do NOT redraw, redesign, or alter anything — you are only reading and reporting what is already drawn.
- Do NOT invent objects that are not actually drawn in the image.
- Do NOT interpret dimension lines, dimension numbers, or measurement tick marks as furniture or objects.
- Clearly differentiate structural elements (walls, doors, windows) from furniture, fixtures ("louças": toilets, sinks, showers), countertops ("bancadas"), staircases, and vehicles — only report the latter group as objects, never the former.
- Detect: beds, sofas, tables, chairs, cabinets/wardrobes, countertops, sinks, toilets, showers, appliances (stoves/fridges/washers), staircases, and cars — plus any other recognizable furniture/fixture/vehicle.
- Consider furniture drawn only as outline/contour lines (no solid fill) — recognize it the same as a filled/shaded icon.
- Preserve the object's apparent position, rotation and proportion — report "orientationDegrees" as your best estimate of the object's rotation in the drawing (0 = "upright"/axis-aligned as commonly drawn, clockwise positive), or null if not applicable/unclear.
- When you are not confident an object is correctly identified, located, or separated from its neighbors, lower its "confidence" value and/or add a note in "warnings" — do not silently guess.
- Use short category codes in English, matching this fixed vocabulary when applicable: comodo (room, only in the rooms list), cama, sofa, mesa, cadeira, armario, bancada, pia, vaso_sanitario, chuveiro, eletrodomestico, escada, veiculo, mobiliario_outro, objeto_outro.
- Return ONLY the structured JSON — no prose, no markdown, no explanation outside the JSON fields themselves.

Coordinates: report every box/point in PIXELS relative to the exact image you were given (not normalized, not relative to any other image) — "imageWidth"/"imageHeight" in your response must match the image's actual pixel dimensions.`;

const OVERVIEW_SUFFIX = `
This is a FIRST, GENERAL PASS over the whole floor plan — its purpose is to locate rooms and objects so a second, detailed pass can zoom into each section. Report bounding boxes only for objects — do not attempt to describe an outline/polygon in this pass.`;

const TILE_SUFFIX = `
This is a DETAILED, ZOOMED-IN pass over one section of a larger floor plan — analyze ONLY the objects visible in this specific image, do not attempt to describe the plan as a whole. For each object, also give a "polygon" (list of {x,y} points in pixels, at least 3 points) outlining its shape, when you have enough confidence to draw a clean outline — otherwise leave "polygon" null rather than guessing one.`;

function buildPrompt(variant: OpenAIVisionVariant, promptContext?: string): string {
  const suffix = variant === 'overview' ? OVERVIEW_SUFFIX : TILE_SUFFIX;
  const base = `${SHARED_INTRO}\n${suffix}`;
  return promptContext ? `${base}\n\n${promptContext}` : base;
}

/**
 * Truncates and strips anything resembling a base64 blob before any error
 * body is logged or stored — defense in depth, same approach used for the
 * Gemini provider.
 */
function sanitizeForLogging(text: string, maxLength = 4000): string {
  const truncated = text.length > maxLength ? `${text.slice(0, maxLength)}…[truncated]` : text;
  return truncated.replace(/[A-Za-z0-9+/]{80,}={0,2}/g, '[BASE64_REDACTED]');
}

/** Maps a thrown OpenAI SDK error to a clear AppError. Logs ONLY status, request id, elapsed time, and a sanitized error body — NEVER headers, NEVER the request (so never the API key or the base64 image). Exported for direct unit testing of each status-code branch (401/429/500/502/503/timeout) without needing a real network call. */
export function classifyOpenAiError(err: unknown, elapsedMs: number): AppError {
  const isApiError = err instanceof OpenAI.APIError;
  const status = isApiError ? err.status : undefined;
  const requestId = isApiError ? (err.requestID ?? null) : null;
  const rawMessage = err instanceof Error ? err.message : String(err);
  const sanitizedMessage = sanitizeForLogging(rawMessage);
  const errorBody = isApiError && err.error ? sanitizeForLogging(JSON.stringify(err.error)) : undefined;
  const isTimeout = err instanceof OpenAI.APIConnectionTimeoutError || /timed? ?out/i.test(rawMessage);

  openaiLogger.error('OpenAI HTTP error', { model: OPENAI_VISION_MODEL, status: status ?? 'n/a', requestId, elapsedMs, body: errorBody ?? '(no body)' });

  const details = `${errorBody ? `${sanitizedMessage} | body: ${errorBody}` : sanitizedMessage} | requestId: ${requestId ?? 'n/a'} | elapsedMs: ${elapsedMs}`;

  if (isTimeout) {
    return new AppError('GENERATION_TIMEOUT', `OpenAI request timed out after ${elapsedMs}ms (limit ${OPENAI_VISION_TIMEOUT_MS}ms). No automatic retry.`, details, 504);
  }
  if (status === 401 || status === 403) {
    return new AppError('INVALID_API_KEY', 'The OpenAI API key was rejected.', details, 401);
  }
  if (status === 429) {
    return new AppError('PROVIDER_UNAVAILABLE', 'OpenAI rate-limited this request. Stopping — no automatic retry and no fallback to a different model.', details, 429);
  }
  if (status === 400 || status === 422) {
    return new AppError('VALIDATION_ERROR', `OpenAI rejected the request (HTTP ${status}).`, details, status);
  }
  if (typeof status === 'number' && status >= 500) {
    return new AppError('PROVIDER_UNAVAILABLE', 'OpenAI is currently unavailable. Please try again later.', details, 502);
  }
  return new AppError('UNKNOWN_ERROR', 'The OpenAI request failed.', details, 500);
}

/**
 * Exactly one OpenAI Responses API call per invocation. No retry, no
 * fallback model. Throws AppError on any failure (network, HTTP, schema
 * validation) — the caller decides whether/how to proceed (e.g. skip this
 * crop, or stop entirely if it was the overview).
 */
export async function detectFurnitureObjectsOpenAI(params: OpenAIVisionDetectParams): Promise<OpenAIVisionDetectResult> {
  const client = getClient();
  const prompt = buildPrompt(params.variant, params.promptContext);
  const schema = params.variant === 'overview' ? OPENAI_OVERVIEW_JSON_SCHEMA : OPENAI_TILE_JSON_SCHEMA;
  const dataUrl = `data:${params.mimeType};base64,${params.imageBase64}`;

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
              { type: 'input_image', image_url: dataUrl, detail: OPENAI_VISION_DETAIL },
            ],
          },
        ],
        // No `tools` field.
        text: {
          format: {
            type: 'json_schema',
            name: params.variant === 'overview' ? 'floorplan_overview' : 'floorplan_tile',
            schema,
            strict: true,
          },
        },
        max_output_tokens: OPENAI_VISION_MAX_OUTPUT_TOKENS,
        // Explicit per user instruction — the response is not retained on
        // OpenAI's side for later retrieval/reuse via previous_response_id.
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
    throw new AppError('UNKNOWN_ERROR', 'OpenAI returned an empty response.', `requestId: ${response.id} | elapsedMs: ${elapsedMs}`, 502);
  }

  const usage: OpenAIVisionUsage | null = response.usage
    ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, totalTokens: response.usage.total_tokens }
    : null;

  // Success telemetry only (no key, no headers, no base64) — lets a real,
  // authorized run's exact per-call count/duration/requestId be reconstructed
  // from the server log after the fact, without changing the request/response
  // contract this route relies on.
  openaiLogger.log('OpenAI vision call completed', { variant: params.variant, model: OPENAI_VISION_MODEL, requestId: response.id, elapsedMs, usage });

  // Structural parse failures (malformed JSON, wrong types, missing fields)
  // are the ONLY thing that throws here — wrapped as a VALIDATION_ERROR
  // AppError so it never falls into a generic UNKNOWN_ERROR at the job
  // level (see routes/generateHumanizedFloorplan.ts's catch block, which
  // classifies purely by `err instanceof AppError`). Semantically-implausible
  // individual detections (wrong size, out of bounds) do NOT throw — they
  // are filtered out one at a time inside parseOpenAIOverviewResponse/
  // parseOpenAITileResponse and never reach this catch.
  if (params.variant === 'overview') {
    let parsed;
    try {
      parsed = parseOpenAIOverviewResponse(outputText, params.cropWidth, params.cropHeight);
    } catch (err) {
      throw new AppError(
        'VALIDATION_ERROR',
        'OpenAI overview response failed structural validation.',
        `${sanitizeForLogging(err instanceof Error ? err.message : String(err))} | requestId: ${response.id} | elapsedMs: ${elapsedMs}`,
        502
      );
    }
    const result: OpenAIVisionResult = {
      imageWidth: parsed.imageWidth,
      imageHeight: parsed.imageHeight,
      rooms: parsed.rooms,
      objects: parsed.objects.map((o) => ({ ...o, polygon: null })),
      warnings: parsed.warnings,
      objectMetrics: parsed.objectMetrics,
      roomMetrics: parsed.roomMetrics,
      discardedObjects: parsed.discardedObjects,
      discardedRooms: parsed.discardedRooms,
    };
    return { result, rawOutputText: outputText, elapsedMs, requestId: response.id, usage };
  }

  let parsed;
  try {
    parsed = parseOpenAITileResponse(outputText, params.cropWidth, params.cropHeight);
  } catch (err) {
    throw new AppError(
      'VALIDATION_ERROR',
      'OpenAI tile response failed structural validation.',
      `${sanitizeForLogging(err instanceof Error ? err.message : String(err))} | requestId: ${response.id} | elapsedMs: ${elapsedMs}`,
      502
    );
  }
  const result: OpenAIVisionResult = {
    imageWidth: parsed.imageWidth,
    imageHeight: parsed.imageHeight,
    rooms: parsed.rooms,
    objects: parsed.objects,
    warnings: parsed.warnings,
    objectMetrics: parsed.objectMetrics,
    roomMetrics: parsed.roomMetrics,
    discardedObjects: parsed.discardedObjects,
    discardedRooms: parsed.discardedRooms,
  };
  return { result, rawOutputText: outputText, elapsedMs, requestId: response.id, usage };
}
