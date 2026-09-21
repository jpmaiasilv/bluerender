import OpenAI from 'openai';
import { openaiLogger } from '../lib/logger';
import { AppError } from '../lib/errors';
import {
  ASTRA_ANALYSIS_JSON_SCHEMA,
  ASTRA_ANALYSIS_SCHEMA_NAME,
  AstraAnalysis,
  AstraAnalysisSchema,
} from '../lib/astra/astraSchemas';
import {
  OPENAI_ASTRA_MAX_OUTPUT_TOKENS,
  OPENAI_ASTRA_MODEL,
  OPENAI_ASTRA_REASONING_EFFORT,
  OPENAI_ASTRA_TIMEOUT_MS,
  OPENAI_ASTRA_VERBOSITY,
} from '../config/openaiModels';
import type { AstraUsage } from '../services/openaiAstraCost';
import { describeOpenAiError, logFields, toAppError } from '../lib/openaiErrors';

/**
 * GPT-6 Astra as an ARCHITECTURAL ANALYSIS layer — it reads
 * images and returns validated JSON. It never renders, edits or generates an
 * image, uses no tools, and is called exactly once per invocation (no SDK
 * retry, no fallback model). Image bytes are only ever sent from the server;
 * they are never logged.
 */

let client: OpenAI | null = null;
let callCount = 0;

function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AppError('INVALID_API_KEY', 'OPENAI_API_KEY is not configured on the server.', undefined, 500);
  client = new OpenAI({ apiKey, timeout: OPENAI_ASTRA_TIMEOUT_MS, maxRetries: 0 });
  return client;
}

export function getAstraCallCount(): number {
  return callCount;
}

export interface AstraCallMeta {
  model: string;
  reasoningEffort: string;
  requestId: string | null;
  durationMs: number;
  usage: AstraUsage | null;
}

type Mime = 'image/png' | 'image/jpeg' | 'image/webp';

interface ImageInput {
  buffer: Buffer;
  mime: Mime;
  label: string;
}

function classify(err: unknown, model: string): AppError {
  const info = describeOpenAiError(err);
  // The ORIGINAL status / code / type / request id / (redacted) message are logged — never the key, headers or images.
  openaiLogger.error('OpenAI Astra HTTP error', logFields(info, model));
  return toAppError(info, 'architectural analysis');
}

async function callAstra<T>(
  schemaName: string,
  schema: object,
  parse: (raw: unknown) => T,
  instructions: string,
  images: ImageInput[]
): Promise<{ parsed: T; meta: AstraCallMeta }> {
  const openai = getClient();
  const content: OpenAI.Responses.ResponseInputContent[] = [{ type: 'input_text', text: instructions }];
  for (const img of images) {
    content.push({ type: 'input_text', text: `Image: ${img.label}` });
    content.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.buffer.toString('base64')}`, detail: 'high' });
  }

  const started = Date.now();
  let response: OpenAI.Responses.Response;
  try {
    callCount += 1;
    response = await openai.responses.create(
      {
        model: OPENAI_ASTRA_MODEL,
        input: [{ role: 'user', content }],
        reasoning: { effort: OPENAI_ASTRA_REASONING_EFFORT },
        text: { verbosity: OPENAI_ASTRA_VERBOSITY, format: { type: 'json_schema', name: schemaName, schema: schema as Record<string, unknown>, strict: true } },
        max_output_tokens: OPENAI_ASTRA_MAX_OUTPUT_TOKENS,
        store: false,
        // No `tools` field: pure image-in / JSON-out.
      },
      { maxRetries: 0, timeout: OPENAI_ASTRA_TIMEOUT_MS }
    );
  } catch (err) {
    throw err instanceof AppError ? err : classify(err, OPENAI_ASTRA_MODEL);
  }
  const durationMs = Date.now() - started;

  const usage: AstraUsage | null = response.usage
    ? {
        inputTokens: response.usage.input_tokens,
        cachedInputTokens: response.usage.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: response.usage.output_tokens,
        reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens ?? null,
        totalTokens: response.usage.total_tokens,
      }
    : null;
  const meta: AstraCallMeta = { model: OPENAI_ASTRA_MODEL, reasoningEffort: OPENAI_ASTRA_REASONING_EFFORT, requestId: response.id ?? null, durationMs, usage };
  openaiLogger.log('OpenAI Astra call completed', { schema: schemaName, model: meta.model, requestId: meta.requestId, durationMs, usage });

  const text = response.output_text;
  if (!text) throw new AppError('VALIDATION_ERROR', 'Astra returned an empty response.', undefined, 502);
  let parsed: T;
  try {
    parsed = parse(JSON.parse(text));
  } catch {
    // The malformed body itself is never logged or stored.
    throw new AppError('VALIDATION_ERROR', 'Astra returned a response that did not match the required structure.', undefined, 502);
  }
  return { parsed, meta };
}

const ANALYSIS_INSTRUCTIONS = `You are the architectural analysis layer of a floor-plan humanization tool. You do NOT draw or generate images.

Task: read the ORIGINAL floor plan (technical drawing, viewed from directly above) and report, as structured data, everything that must be preserved when another model turns it into a photorealistic humanized plan.

Rules:
- The ORIGINAL floor plan is the ONLY source of architecture. If a STYLE REFERENCE image is provided, use it exclusively for colors, textures, materials, furniture/block look, vegetation, shadows and graphic language — never for walls, rooms, openings, stairs, dimensions, proportions or layout.
- Describe only what you can actually see. Do not present estimates as precise measurements. If something is unclear, say so instead of guessing.
- Be concise: short factual phrases, at most a handful of items per list.
- "recommended_prompt" is a short paragraph (max ~600 characters) of extra guidance for the image generator that reinforces preservation; it must never ask to change the architecture.
- Return ONLY the structured JSON.`;

export interface AnalyzeParams {
  original: { buffer: Buffer; mime: Mime };
  reference?: { buffer: Buffer; mime: Mime } | null;
  /** Plain-text summary of the user's chosen options (style, lighting, surroundings, advanced settings, instructions). */
  settingsSummary: string;
}

export async function analyzeFloorplanWithAstra(p: AnalyzeParams): Promise<{ analysis: AstraAnalysis; meta: AstraCallMeta }> {
  const images: ImageInput[] = [{ buffer: p.original.buffer, mime: p.original.mime, label: 'ORIGINAL floor plan (the only source of architecture)' }];
  if (p.reference) images.push({ buffer: p.reference.buffer, mime: p.reference.mime, label: 'STYLE REFERENCE (visual style only, never architecture)' });
  const { parsed, meta } = await callAstra(ASTRA_ANALYSIS_SCHEMA_NAME, ASTRA_ANALYSIS_JSON_SCHEMA, (raw) => AstraAnalysisSchema.parse(raw), `${ANALYSIS_INSTRUCTIONS}\n\nUser settings:\n${p.settingsSummary}`, images);
  return { analysis: parsed, meta };
}
