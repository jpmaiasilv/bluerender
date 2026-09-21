import { GoogleGenAI, Modality } from '@google/genai';
import { geminiLogger } from '../lib/logger';
import { AppError } from '../lib/errors';
import { GenerateRenderParams, GenerateRenderResult, ProviderModel, RenderProvider } from './types';

/**
 * Google Gemini as a Render IA engine ("Nano Banana 2" — Gemini's own public
 * nickname for this image model family, confirmed directly against the
 * account's live ListModels response: gemini-3.1-flash-image's displayName
 * IS "Nano Banana 2", not a name invented here). A completely separate
 * concern from providers/geminiVision.ts (floor-plan furniture RECOGNITION,
 * text/JSON output only, uses the Interactions API) — this one generates an
 * image from a prompt, optionally with one or two input images (Render IA /
 * Gerador de Ideias' image-to-image mode) or none at all (pure text-to-image,
 * for Imagem por Texto and Gerador de Ideias' text-to-image mode), using the
 * classic `ai.models.generateContent` call with `responseModalities: [IMAGE]`.
 *
 * Same shape as the other Render IA providers: one call, no retry, no mask,
 * no fallback model. Reuses the SAME GEMINI_API_KEY already configured for
 * geminiVision.ts — no new secret needed.
 */

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (client) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AppError('INVALID_API_KEY', 'GEMINI_API_KEY is not configured on the server.', 'Add GEMINI_API_KEY to backend/.env and restart the server.', 500);
  }
  client = new GoogleGenAI({ apiKey });
  return client;
}

/** Real, current model id confirmed via ListModels (displayName "Nano Banana 2") — not guessed. Override only if Google renames/retires it. */
export const GEMINI_RENDER_MODEL = process.env.GEMINI_RENDER_MODEL || 'gemini-3.1-flash-image';
const GEMINI_RENDER_TIMEOUT_MS = Number(process.env.GEMINI_RENDER_TIMEOUT_MS) || 5 * 60 * 1000;

interface SdkErrorShape {
  status?: number;
  message?: string;
}

/** Same classification family as geminiVision.ts's classifySdkError, kept independent per this codebase's convention of one provider file owning its own error mapping. Logs ONLY status + a redacted message — never the key, headers or image bytes. */
function classifyGeminiRenderError(err: unknown): AppError {
  const shaped = err as SdkErrorShape;
  const status = shaped?.status;
  const rawMessage = err instanceof Error ? err.message : String(err);
  const sanitized = rawMessage.replace(/[A-Za-z0-9+/]{80,}={0,2}/g, '[BASE64_REDACTED]').slice(0, 500);
  geminiLogger.error('Gemini render HTTP error', { model: GEMINI_RENDER_MODEL, status: status ?? 'n/a' });

  const isQuotaOrFreeTierIssue = status === 429 || /RESOURCE_EXHAUSTED/i.test(rawMessage) || /quota/i.test(rawMessage) || /free.?tier/i.test(rawMessage);
  if (isQuotaOrFreeTierIssue) {
    return new AppError('PROVIDER_UNAVAILABLE', 'Gemini rate-limited this request or its quota is exhausted. Please try again shortly.', sanitized, 429);
  }
  if (status === 401 || status === 403 || /API key/i.test(rawMessage)) {
    return new AppError('INVALID_API_KEY', 'The Gemini API key was rejected.', sanitized, 401);
  }
  if (status === 400 || status === 422) {
    return new AppError('VALIDATION_ERROR', `Gemini rejected the request (HTTP ${status}).`, sanitized, status);
  }
  if (typeof status === 'number' && status >= 500) {
    return new AppError('PROVIDER_UNAVAILABLE', 'Gemini is currently unavailable. Please try again later.', sanitized, 502);
  }
  return new AppError('UNKNOWN_ERROR', 'The Gemini render request failed.', sanitized, 500);
}

const MODELS: ProviderModel[] = [{ id: GEMINI_RENDER_MODEL, label: 'Nano Banana 2' }];

export const geminiRenderProvider: RenderProvider = {
  id: 'gemini',
  label: 'Google',
  models: MODELS,

  async generateRender(modelId: string, params: GenerateRenderParams): Promise<GenerateRenderResult> {
    if (!MODELS.some((m) => m.id === modelId)) {
      throw new AppError('PROVIDER_UNAVAILABLE', `Unknown Gemini render model: ${modelId}`, undefined, 400);
    }

    const ai = getClient();
    // Same three shapes as openaiRenderProvider.ts: the caller's own image when given, the
    // reference alone when that is the only image, or neither for pure text-to-image — never
    // both a "primary" and "secondary" unless the caller actually sent two distinct images.
    const primaryBase64 = params.imageBase64 ?? params.referenceImageBase64;
    const primaryMime = params.imageBase64 ? params.imageMimeType ?? 'image/png' : params.referenceImageMimeType ?? 'image/png';
    const secondaryBase64 = params.imageBase64 ? params.referenceImageBase64 : undefined;
    const secondaryMime = params.referenceImageMimeType ?? 'image/png';

    const contents: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [{ text: params.prompt }];
    if (primaryBase64) contents.push({ inlineData: { data: primaryBase64, mimeType: primaryMime } });
    if (secondaryBase64) contents.push({ inlineData: { data: secondaryBase64, mimeType: secondaryMime } });

    try {
      const response = await ai.models.generateContent({
        model: modelId,
        contents,
        config: {
          responseModalities: [Modality.IMAGE],
          // No automatic retry (attempts: 1) — same "exactly one HTTP call, no hidden retry"
          // policy as geminiVision.ts; a failed render is reported and refunded, never silently retried.
          httpOptions: { timeout: GEMINI_RENDER_TIMEOUT_MS, retryOptions: { attempts: 1 } },
        },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find((p) => p.inlineData?.data);
      if (!imagePart?.inlineData?.data) {
        const blockReason = response.promptFeedback?.blockReason;
        if (blockReason) {
          throw new AppError('GENERATION_FAILED', `Gemini declined to generate this image (${blockReason}).`, undefined, 422);
        }
        throw new AppError('UNKNOWN_ERROR', 'Gemini returned no image data for the render.', undefined, 502);
      }

      const mimeType = imagePart.inlineData.mimeType || 'image/png';
      return {
        imageBuffer: Buffer.from(imagePart.inlineData.data, 'base64'),
        contentType: mimeType,
        // Gemini's response carries no stable request id in the parsed body — minted here purely
        // as a stable filename for saveResultImage(), never presented as a real Gemini request id.
        requestId: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw classifyGeminiRenderError(err);
    }
  },
};
