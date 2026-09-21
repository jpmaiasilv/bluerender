import OpenAI, { toFile } from 'openai';
import { openaiLogger } from '../lib/logger';
import { AppError } from '../lib/errors';
import { validateBlockImagePng, BlockPngValidationResult } from '../lib/blockImage/pngValidation';
import { OPENAI_BLOCK_IMAGE_MODEL } from '../config/openaiModels';
import { describeOpenAiError, logFields, toAppError } from '../lib/openaiErrors';

/**
 * OpenAI furniture-BLOCK image generation — a completely separate concern
 * from providers/openaiVision.ts (recognition) and from
 * providers/bflFill.ts (floor-plan humanization). This file is NOT called
 * from anywhere in the codebase yet: it's implemented and ready so the
 * pipeline can be wired up later, but per explicit requirement no real
 * image-generation call happens during this round of work. Local tests
 * exercise buildBlockImagePrompt() and validateBlockImagePng() directly,
 * never generateBlockImage() itself.
 */

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AppError('INVALID_API_KEY', 'OPENAI_API_KEY is not configured on the server.', 'Add OPENAI_API_KEY to backend/.env and restart the server.', 500);
  }
  client = new OpenAI({ apiKey });
  return client;
}

export type BlockQuality = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';

export interface GenerateBlockImageParams {
  prompt: string;
  category: string;
  subcategory?: string | null;
  style?: string | null;
  /** Approximate real-world footprint, in meters — purely descriptive context for the prompt, never used to compute pixel sizing. */
  approxWidthMeters?: number | null;
  approxDepthMeters?: number | null;
  /** Optional reference image (e.g. a photo of a similar piece) — when given, the provider uses images.edit() instead of images.generate(). */
  referenceImageBuffer?: Buffer | null;
  referenceImageMimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  colorsAndMaterials?: string | null;
  orientationNotes?: string | null;
  quality?: BlockQuality;
}

export interface GenerateBlockImageResult {
  pngBuffer: Buffer;
  /** Real OpenAI cost for this call, once available from the response — null until that's confirmed against a real call (never estimated/guessed here). */
  providerCostUsd: number | null;
  requestId: string | null;
  validation: BlockPngValidationResult;
}

/**
 * The fixed rendering contract every block must follow, per explicit
 * requirement — background/format/framing rules that are NEVER left to the
 * caller to override, only the subject itself (prompt/category/style/etc.)
 * varies per call.
 */
export function buildBlockImagePrompt(params: GenerateBlockImageParams): string {
  const sizeNote =
    params.approxWidthMeters != null && params.approxDepthMeters != null
      ? ` Approximate real-world footprint: ${params.approxWidthMeters}m x ${params.approxDepthMeters}m.`
      : '';
  const materialsNote = params.colorsAndMaterials ? ` Colors/materials: ${params.colorsAndMaterials}.` : '';
  const orientationNote = params.orientationNotes ? ` Orientation notes: ${params.orientationNotes}.` : '';
  const subcategoryNote = params.subcategory ? ` (${params.subcategory})` : '';
  const styleNote = params.style ? ` Style: ${params.style}.` : '';

  return `Generate a single furniture/fixture object: ${params.category}${subcategoryNote}. ${params.prompt}${styleNote}${sizeNote}${materialsNote}${orientationNote}

Strict rendering rules — follow exactly:
- Exactly ONE object, nothing else in the frame.
- Orthographic view, EXACTLY from directly above (top-down plan view) — like an architectural furniture symbol, not a perspective or 3/4 view.
- Object centered in the frame.
- No floor, no wall, no room, no environment of any kind.
- No perspective, no camera angle — a true flat top-down orthographic projection.
- No text, no watermark, no brand marks, no logos.
- No additional objects, props, or decoration besides the one requested item.
- A soft, subtle INTERNAL shadow (under/within the object's own form) is allowed for depth, but there must be NO external drop shadow that could be cropped by the image edge.
- Fully transparent background — the object must not touch or bleed into the image border.`;
}

function classifyOpenAiImageError(err: unknown): AppError {
  const info = describeOpenAiError(err);
  // The ORIGINAL status / code / type / request id / (redacted) message are logged — never the key, headers or images.
  openaiLogger.error('OpenAI block-image HTTP error', logFields(info, OPENAI_BLOCK_IMAGE_MODEL));
  return toAppError(info, 'image generation');
}

/**
 * NEVER CALLED by any script/route in this round of work — implemented and
 * ready, per requirement, but real invocation is explicitly out of scope
 * until separately authorized. When it does run: background=transparent,
 * output_format=png, n=1, model=OPENAI_BLOCK_IMAGE_MODEL (never hardcoded
 * elsewhere), and the result is always run through validateBlockImagePng
 * before being considered usable — an imperfect-transparency result is
 * returned with `validation.valid === false`, never silently accepted.
 */
export async function generateBlockImage(params: GenerateBlockImageParams): Promise<GenerateBlockImageResult> {
  const openai = getClient();
  const prompt = buildBlockImagePrompt(params);

  let b64: string | undefined;
  try {
    if (params.referenceImageBuffer) {
      const file = await toFile(params.referenceImageBuffer, 'reference.png', { type: params.referenceImageMimeType ?? 'image/png' });
      const response = await openai.images.edit(
        {
          image: file,
          prompt,
          model: OPENAI_BLOCK_IMAGE_MODEL,
          background: 'transparent',
          output_format: 'png',
          n: 1,
          quality: params.quality ?? 'auto',
        },
        { maxRetries: 0 }
      );
      b64 = response.data?.[0]?.b64_json;
    } else {
      const response = await openai.images.generate(
        {
          prompt,
          model: OPENAI_BLOCK_IMAGE_MODEL,
          background: 'transparent',
          output_format: 'png',
          n: 1,
          quality: params.quality ?? 'auto',
        },
        { maxRetries: 0 }
      );
      b64 = response.data?.[0]?.b64_json;
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw classifyOpenAiImageError(err);
  }

  if (!b64) {
    throw new AppError('UNKNOWN_ERROR', 'OpenAI returned no image data for the block.', undefined, 502);
  }

  const pngBuffer = Buffer.from(b64, 'base64');
  const validation = await validateBlockImagePng(pngBuffer);

  return {
    pngBuffer,
    // Real per-call cost isn't in the current SDK's ImagesResponse in a
    // directly billable-USD form for every image model — left null rather
    // than guessed; a real implementation surfaces this once confirmed
    // against an authorized live call's actual response shape.
    providerCostUsd: null,
    requestId: null,
    validation,
  };
}

/**
 * ============================================================================
 * Planta Humanizada SIMPLE flow (2026-09-19 pivot) — a completely different
 * use case from the block generator above (whole floor plan image-to-image,
 * not a single transparent-background object), sharing only this module's
 * OpenAI client setup and error classification. The block-image functions
 * above are UNCHANGED and still never called anywhere.
 *
 * Uses the SAME confirmed-real SDK shape (`openai.images.edit()` with a
 * reference image via `toFile()`) the block generator already used, per the
 * explicit decision to reuse this provider file. `background: 'opaque'` and
 * no transparency validation this time — a full rendered floor plan, not a
 * cutout asset.
 * ============================================================================
 */

export interface GenerateHumanizedFloorplanImageParams {
  /** The original, unmodified floor plan image — image 1, the ONLY source of architecture. */
  originalImageBuffer: Buffer;
  originalImageMimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Optional style reference — image 2, used for visual style only (the prompt says so explicitly). */
  styleReferenceBuffer?: Buffer | null;
  styleReferenceMimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  /** The complete, already-assembled prompt (lib/openaiImage/humanizedFloorplanPrompt.ts) — this provider never builds prompt text itself. */
  prompt: string;
  /** Explicit OpenAI output size, or null/undefined to send none (provider default). */
  size?: '1024x1024' | '1536x1024' | '1024x1536' | null;
  quality?: BlockQuality;
}

export interface HumanizedFloorplanProviderUsage {
  textInputTokens: number | null;
  imageInputTokens: number | null;
  imageOutputTokens: number | null;
  totalTokens: number | null;
}

export interface GenerateHumanizedFloorplanImageResult {
  pngBuffer: Buffer;
  /** OpenAI does not return a request id in the parsed body; left null rather than invented. */
  requestId: string | null;
  usage: HumanizedFloorplanProviderUsage | null;
  /** Quality / size the API reports it actually used, when present in the response. */
  effectiveQuality: string | null;
  effectiveSize: string | null;
}

/** A generation that has not answered by then is abandoned (and refunded by the caller). */
const HUMANIZED_FLOORPLAN_REQUEST_TIMEOUT_MS = Number(process.env.HUMANIZED_FLOORPLAN_REQUEST_TIMEOUT_MS) || 5 * 60 * 1000;

function extensionForMime(mime: string): string {
  return mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
}

/**
 * Exactly one OpenAI Images API call (images.edit). Image 1 is always the
 * original floor plan; image 2, when given, is the style reference. No
 * retry, no mask, no fallback model. Throws AppError on any failure — the
 * caller must let it propagate so the generation ends failed and refunded.
 */
export async function generateHumanizedFloorplanImage(params: GenerateHumanizedFloorplanImageParams): Promise<GenerateHumanizedFloorplanImageResult> {
  const openai = getClient();

  let b64: string | undefined;
  let usage: HumanizedFloorplanProviderUsage | null = null;
  let effectiveQuality: string | null = null;
  let effectiveSize: string | null = null;
  try {
    const original = await toFile(params.originalImageBuffer, `floorplan-original.${extensionForMime(params.originalImageMimeType)}`, { type: params.originalImageMimeType });
    const images = [original];
    if (params.styleReferenceBuffer) {
      const mime = params.styleReferenceMimeType ?? 'image/png';
      images.push(await toFile(params.styleReferenceBuffer, `style-reference.${extensionForMime(mime)}`, { type: mime }));
    }

    const response = await openai.images.edit(
      {
        image: images.length === 1 ? images[0] : images,
        prompt: params.prompt,
        model: OPENAI_BLOCK_IMAGE_MODEL,
        background: 'opaque',
        output_format: 'png',
        n: 1,
        quality: params.quality ?? 'auto',
        ...(params.size ? { size: params.size } : {}),
        // input_fidelity is NOT sent: this model rejects it with HTTP 400
        // (invalid_input_fidelity_model, confirmed 2026-09-19). Layout
        // fidelity is carried by the prompt instead.
      },
      { maxRetries: 0, timeout: HUMANIZED_FLOORPLAN_REQUEST_TIMEOUT_MS }
    );
    b64 = response.data?.[0]?.b64_json;
    effectiveQuality = response.quality ?? null;
    effectiveSize = response.size ?? null;
    if (response.usage) {
      usage = {
        textInputTokens: response.usage.input_tokens_details?.text_tokens ?? null,
        imageInputTokens: response.usage.input_tokens_details?.image_tokens ?? null,
        imageOutputTokens: response.usage.output_tokens ?? null,
        totalTokens: response.usage.total_tokens ?? null,
      };
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw classifyOpenAiImageError(err);
  }

  if (!b64) {
    throw new AppError('UNKNOWN_ERROR', 'OpenAI returned no image data for the humanized floor plan.', undefined, 502);
  }

  return { pngBuffer: Buffer.from(b64, 'base64'), requestId: null, usage, effectiveQuality, effectiveSize };
}
