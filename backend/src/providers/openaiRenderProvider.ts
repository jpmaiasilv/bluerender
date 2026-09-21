import OpenAI, { toFile } from 'openai';
import { openaiLogger } from '../lib/logger';
import { AppError } from '../lib/errors';
import { describeOpenAiError, logFields, toAppError } from '../lib/openaiErrors';
import { pickNearestSize } from '../lib/openaiImage/openaiImageSizes';
import { OPENAI_BLOCK_IMAGE_MODEL } from '../config/openaiModels';
import { GenerateRenderParams, GenerateRenderResult, ProviderModel, RenderProvider } from './types';

/**
 * OpenAI as an image engine ("GPT Image"), used by Render IA, Imagem por
 * Texto and Gerador de Ideias alongside the existing BFL FLUX.2 provider —
 * a completely separate concern from providers/openaiBlockImage.ts (Planta
 * Humanizada / furniture blocks). Uses the exact same prompt each caller
 * already builds for BFL (provider-agnostic natural-language text, nothing
 * FLUX-specific in it).
 *
 * Three shapes, chosen from what the caller actually sent — never guessed:
 *   - imageBase64 present -> images.edit() on that image (+ the reference as
 *     a second image, when both are given): Render IA and Gerador de Ideias'
 *     image-to-image mode.
 *   - no imageBase64 but a referenceImageBase64 -> images.edit() using the
 *     reference AS the base to riff on (the only image actually available).
 *   - neither -> images.generate(): pure text-to-image (Imagem por Texto,
 *     Gerador de Ideias' text-to-image mode).
 * No retry, no fallback model, no mask. OpenAI does not accept arbitrary
 * pixel dimensions like BFL does — the nearest of its few fixed output sizes
 * is picked from the requested aspect ratio instead.
 */

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AppError('INVALID_API_KEY', 'OPENAI_API_KEY is not configured on the server.', 'Add OPENAI_API_KEY to backend/.env and restart the server.', 500);
  }
  client = new OpenAI({ apiKey, maxRetries: 0 });
  return client;
}

/** A generation that has not answered by then is abandoned (and refunded by the caller) — same default as the humanized-floorplan provider's own request timeout. */
const RENDER_REQUEST_TIMEOUT_MS = Number(process.env.OPENAI_RENDER_TIMEOUT_MS) || 5 * 60 * 1000;

function extensionForMime(mime: string): string {
  return mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
}

function classifyOpenAiRenderError(err: unknown): AppError {
  const info = describeOpenAiError(err);
  // The ORIGINAL status / code / type / request id / (redacted) message are logged — never the key, headers or images.
  openaiLogger.error('OpenAI render HTTP error', logFields(info, OPENAI_BLOCK_IMAGE_MODEL));
  return toAppError(info, 'render generation');
}

const MODELS: ProviderModel[] = [{ id: OPENAI_BLOCK_IMAGE_MODEL, label: 'GPT Image' }];

export const openaiRenderProvider: RenderProvider = {
  id: 'openai',
  label: 'OpenAI',
  models: MODELS,

  async generateRender(modelId: string, params: GenerateRenderParams): Promise<GenerateRenderResult> {
    if (!MODELS.some((m) => m.id === modelId)) {
      throw new AppError('PROVIDER_UNAVAILABLE', `Unknown OpenAI render model: ${modelId}`, undefined, 400);
    }

    const openai = getClient();
    const size = params.width && params.height ? pickNearestSize(params.width, params.height) : undefined;

    // The "main" image to edit: the caller's own image when given, otherwise the
    // reference (the only image left) — never both slots empty and an image still sent.
    const primaryBase64 = params.imageBase64 ?? params.referenceImageBase64;
    const primaryMime = params.imageBase64 ? params.imageMimeType ?? 'image/png' : params.referenceImageMimeType ?? 'image/png';
    // A second image slot only makes sense once the primary is the caller's own image
    // AND a distinct reference was also given — otherwise the reference already became primary above.
    const secondaryBase64 = params.imageBase64 ? params.referenceImageBase64 : undefined;
    const secondaryMime = params.referenceImageMimeType ?? 'image/png';

    let b64: string | undefined;
    try {
      if (primaryBase64) {
        const images = [await toFile(Buffer.from(primaryBase64, 'base64'), `render-source.${extensionForMime(primaryMime)}`, { type: primaryMime })];
        if (secondaryBase64) {
          images.push(await toFile(Buffer.from(secondaryBase64, 'base64'), `render-reference.${extensionForMime(secondaryMime)}`, { type: secondaryMime }));
        }
        const response = await openai.images.edit(
          {
            image: images.length === 1 ? images[0] : images,
            prompt: params.prompt,
            model: modelId,
            background: 'opaque',
            output_format: params.outputFormat,
            n: 1,
            quality: 'auto',
            ...(size ? { size } : {}),
            // input_fidelity is NOT sent: this model rejects it with HTTP 400 (invalid_input_fidelity_model)
            // — the same finding already documented in openaiBlockImage.ts for the same model family.
          },
          { maxRetries: 0, timeout: RENDER_REQUEST_TIMEOUT_MS }
        );
        b64 = response.data?.[0]?.b64_json;
      } else {
        // Pure text-to-image — no image of any kind was given.
        const response = await openai.images.generate(
          {
            prompt: params.prompt,
            model: modelId,
            background: 'opaque',
            output_format: params.outputFormat,
            n: 1,
            quality: 'auto',
            ...(size ? { size } : {}),
          },
          { maxRetries: 0, timeout: RENDER_REQUEST_TIMEOUT_MS }
        );
        b64 = response.data?.[0]?.b64_json;
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw classifyOpenAiRenderError(err);
    }

    if (!b64) {
      throw new AppError('UNKNOWN_ERROR', 'OpenAI returned no image data for the render.', undefined, 502);
    }

    return {
      imageBuffer: Buffer.from(b64, 'base64'),
      contentType: params.outputFormat === 'png' ? 'image/png' : 'image/jpeg',
      // OpenAI's response carries no request id in the parsed body — a fresh id is
      // minted here purely as a stable filename for saveResultImage(), same as any
      // other job id in this codebase; it is never presented as an OpenAI request id.
      requestId: `openai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    };
  },
};
