import { GoogleGenAI } from '@google/genai';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { geminiLogger } from '../lib/logger';
import { AppError } from '../lib/errors';

/**
 * Google Veo 3.1 video generation via the Gemini API — same GEMINI_API_KEY
 * already used for Nano Banana 2 (geminiRenderProvider.ts), no new secret.
 *
 * Active video provider as of 2026-10-02 (chosen for cost: Veo 3.1 Lite at
 * 720p is $0.05/s, confirmed at ai.google.dev/gemini-api/docs/pricing — well
 * under xAI's real observed ~$0.14/s for grok-imagine-video-1.5). xAI's
 * provider (xaiVideo.ts) is deliberately left in place, untouched and
 * unused, so it can be switched back in by changing config/videoEngines.ts
 * alone if ever needed.
 *
 * image + config.lastFrame is Veo's own real "first & last frame"
 * interpolation parameter (confirmed in the official Veo 3.1 docs,
 * ai.google.dev/gemini-api/docs/veo) — the same capability xaiVideo.ts
 * exposes for Grok, not reimplemented as prompt text.
 *
 * Flow: ai.models.generateVideos() returns a long-running operation; poll
 * ai.operations.getVideosOperation() until done; download the result via
 * ai.files.download() (the SDK's own documented way to fetch a generated
 * video by reference) into a throwaway temp file, read it back into memory,
 * then delete the temp file.
 */

export type GeminiVideoModel = 'veo-3.1-lite-generate-preview' | 'veo-3.1-fast-generate-preview' | 'veo-3.1-generate-preview';
export type GeminiVideoResolution = '720p' | '1080p';

export interface GeminiVideoGenerateParams {
  prompt: string;
  /** Raw base64 (no data: prefix) of a starting image, for image-to-video. Omit for pure text-to-video. */
  imageBase64?: string;
  imageMimeType?: string;
  /** Raw base64 of a final-frame image — only valid alongside imageBase64 (Veo rejects last-frame-only requests). */
  lastFrameBase64?: string;
  lastFrameMimeType?: string;
  durationSeconds: number;
  resolution?: GeminiVideoResolution;
  /** Defaults to the Lite tier (cheapest) — overridable for backend-side cost/quality comparisons, same convention as xaiVideo.ts. */
  model?: GeminiVideoModel;
  onProviderStatus?: (status: string) => void;
}

export interface GeminiVideoGenerateResult {
  videoBuffer: Buffer;
  contentType: string;
  requestId: string;
  durationSeconds: number;
  costUsd: number | null;
}

const DEFAULT_MODEL: GeminiVideoModel = 'veo-3.1-lite-generate-preview';
const DEFAULT_RESOLUTION: GeminiVideoResolution = '720p';
// Veo generations run noticeably longer than xAI's — start polling slower to avoid wasted calls.
const POLL_START_DELAY_MS = 5000;
const POLL_MAX_DELAY_MS = 15000;
const POLL_BACKOFF_FACTOR = 1.3;
const POLL_TIMEOUT_MS = Number(process.env.GEMINI_VIDEO_POLL_TIMEOUT_MS) || 6 * 60 * 1000;

/** Official per-second prices (ai.google.dev/gemini-api/docs/pricing, confirmed 2026-10-02) — audio included, not an extra line item since generateAudio is left off below. */
const PRICE_PER_SECOND: Record<GeminiVideoModel, Partial<Record<GeminiVideoResolution, number>>> = {
  'veo-3.1-lite-generate-preview': { '720p': 0.05, '1080p': 0.08 },
  'veo-3.1-fast-generate-preview': { '720p': 0.1, '1080p': 0.12 },
  'veo-3.1-generate-preview': { '720p': 0.4, '1080p': 0.4 },
};

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

interface SdkErrorShape {
  status?: number;
  message?: string;
}

/** Same classification family as geminiRenderProvider.ts's — kept as its own copy per this codebase's convention of one provider file owning its own error mapping. Logs ONLY status + a redacted message — never the key or image/video bytes. */
function classifyGeminiVideoError(err: unknown): AppError {
  const shaped = err as SdkErrorShape;
  const status = shaped?.status;
  const rawMessage = err instanceof Error ? err.message : String(err);
  const sanitized = rawMessage.replace(/[A-Za-z0-9+/]{80,}={0,2}/g, '[BASE64_REDACTED]').slice(0, 500);
  geminiLogger.error('Gemini video HTTP error', { status: status ?? 'n/a' });

  const isQuotaOrFreeTierIssue = status === 429 || /RESOURCE_EXHAUSTED/i.test(rawMessage) || /quota/i.test(rawMessage);
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
  return new AppError('UNKNOWN_ERROR', 'The Gemini video request failed.', sanitized, 500);
}

export async function generateVideo(params: GeminiVideoGenerateParams): Promise<GeminiVideoGenerateResult> {
  const ai = getClient();
  const model = params.model || DEFAULT_MODEL;
  const resolution = params.resolution || DEFAULT_RESOLUTION;

  try {
    geminiLogger.log(
      `Video request created (model=${model}, duration=${params.durationSeconds}s, resolution=${resolution}, hasImage=${Boolean(params.imageBase64)}, hasLastFrame=${Boolean(params.lastFrameBase64)})`
    );

    let operation = await ai.models.generateVideos({
      model,
      prompt: params.prompt,
      image: params.imageBase64 ? { imageBytes: params.imageBase64, mimeType: params.imageMimeType || 'image/png' } : undefined,
      config: {
        numberOfVideos: 1,
        durationSeconds: params.durationSeconds,
        resolution,
        // Left off on purpose: keeps cost exactly at the documented per-second
        // rate with no audio line item, since nothing in the product asks for sound yet.
        generateAudio: false,
        lastFrame: params.lastFrameBase64 ? { imageBytes: params.lastFrameBase64, mimeType: params.lastFrameMimeType || 'image/png' } : undefined,
      },
    });

    const startedAt = Date.now();
    let delay = POLL_START_DELAY_MS;
    while (!operation.done) {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        throw new AppError('GENERATION_TIMEOUT', 'The video took too long to generate.', `Exceeded ${POLL_TIMEOUT_MS}ms polling timeout`, 504);
      }
      params.onProviderStatus?.('processing');
      geminiLogger.log('Processing (operation not done yet)');
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * POLL_BACKOFF_FACTOR, POLL_MAX_DELAY_MS);
      operation = await ai.operations.getVideosOperation({ operation });
    }

    if (operation.error) {
      throw new AppError('GENERATION_FAILED', 'Gemini failed to generate the video.', JSON.stringify(operation.error).slice(0, 500), 502);
    }
    const generated = operation.response?.generatedVideos?.[0]?.video;
    if (!generated) {
      throw new AppError('UNKNOWN_ERROR', 'Gemini returned no video for this request.', undefined, 502);
    }

    let buffer: Buffer;
    if (generated.videoBytes) {
      buffer = Buffer.from(generated.videoBytes, 'base64');
    } else {
      // The SDK's own documented way to fetch a generated video by reference
      // (handles the API-key-authenticated download internally) writes to a
      // path rather than returning bytes — use a throwaway temp file.
      const tempPath = path.join(os.tmpdir(), `gemini-video-${crypto.randomUUID()}.mp4`);
      await ai.files.download({ file: generated, downloadPath: tempPath });
      buffer = fs.readFileSync(tempPath);
      fs.unlink(tempPath, () => {
        // Best-effort cleanup — a leftover temp file is never user-visible and the OS reclaims it eventually.
      });
    }

    const perSecond = PRICE_PER_SECOND[model]?.[resolution];
    const costUsd = typeof perSecond === 'number' ? perSecond * params.durationSeconds : null;

    geminiLogger.log(`Video generation completed (bytes=${buffer.length})`);
    return {
      videoBuffer: buffer,
      contentType: generated.mimeType || 'video/mp4',
      // Gemini's operation response carries no stable short request id — minted here purely
      // as a stable filename for saveResultVideo(), never presented as a real Gemini request id.
      requestId: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      durationSeconds: params.durationSeconds,
      costUsd,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw classifyGeminiVideoError(err);
  }
}
