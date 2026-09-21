import { xaiLogger } from '../lib/logger';
import { AppError } from '../lib/errors';

/**
 * xAI Grok Imagine Video integration.
 *
 * Reference: official xAI docs (docs.x.ai/developers/model-capabilities/video,
 * docs.x.ai/developers/rest-api-reference/inference/videos), verified live
 * 2026-08-25. Flow: POST /v1/videos/generations -> { request_id } -> GET
 * /v1/videos/{request_id} until status is "done" (video.url) or "failed"/
 * "expired". video.url is a temporary xAI-hosted link, so it's downloaded
 * immediately — same pattern as the BFL provider's image results.
 */

const BASE_URL = process.env.XAI_BASE_URL || 'https://api.x.ai';
const POLL_TIMEOUT_MS = Number(process.env.XAI_POLL_TIMEOUT_MS) || 300_000; // video generation runs longer than image generation
const POLL_START_DELAY_MS = 2000;
const POLL_MAX_DELAY_MS = 8000;
const POLL_BACKOFF_FACTOR = 1.5;
const FETCH_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 60_000; // videos are larger than images

export type XaiVideoResolution = '480p' | '720p' | '1080p';
export type XaiVideoModel = 'grok-imagine-video' | 'grok-imagine-video-1.5';

const DEFAULT_MODEL: XaiVideoModel = 'grok-imagine-video-1.5';
const DEFAULT_RESOLUTION: XaiVideoResolution = '720p';

export interface XaiVideoGenerateParams {
  prompt: string;
  /** Raw base64 (no data: prefix) of a source image, for image-to-video. Omit for pure text-to-video. */
  imageBase64?: string;
  imageMimeType?: string;
  durationSeconds: number;
  resolution?: XaiVideoResolution;
  /** Defaults to grok-imagine-video-1.5. Not yet exposed to end users — kept overridable for backend-side cost/quality comparisons between the two real models. */
  model?: XaiVideoModel;
  onProviderStatus?: (status: string) => void;
}

export interface XaiVideoGenerateResult {
  videoBuffer: Buffer;
  contentType: string;
  requestId: string;
  durationSeconds: number;
  /** Real cost reported by xAI for this generation, if provided. */
  costUsd: number | null;
}

/** Same cause-chain walk used by the BFL provider — kept as its own small copy here rather than a shared import, so neither provider's network-error handling can accidentally regress the other. */
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

  if (name === 'AbortError' || name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return { kind: 'TIMEOUT', message };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { kind: 'DNS_RESOLUTION_FAILED', message };
  }
  if (code === 'ECONNREFUSED') {
    return { kind: 'CONNECTION_REFUSED', message };
  }
  if (code === 'ECONNRESET') {
    return { kind: 'CONNECTION_RESET', message };
  }
  return { kind: code || name || 'NETWORK_ERROR', message };
}

function getApiKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) {
    throw new AppError(
      'INVALID_API_KEY',
      'XAI_API_KEY is not configured on the server.',
      'Add XAI_API_KEY to backend/.env and restart the server.',
      500
    );
  }
  return key;
}

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

/**
 * xAI's error responses aren't fully consistent in shape: most endpoints use
 * `{ error: { code, message } }`, but at least the auth-failure case observed
 * live (2026-08-25) returns a flatter `{ code, error }` where `error` is the
 * message string itself, not a nested object. Handle both rather than
 * assuming one and masking the real message behind a generic HTTP status text.
 */
async function parseErrorBody(res: Response): Promise<{ code?: string; message: string; raw: string }> {
  const raw = await res.text();
  try {
    const data = JSON.parse(raw) as { error?: { code?: string; message?: string } | string; code?: string };
    if (typeof data.error === 'string') {
      return { code: data.code, message: data.error, raw };
    }
    return { code: data.error?.code ?? data.code, message: data.error?.message || res.statusText, raw };
  } catch {
    return { message: res.statusText, raw };
  }
}

function mapHttpError(status: number, body: { code?: string; message: string; raw: string }): AppError {
  const details = body.code ? `${body.code}: ${body.message}` : body.message || body.raw.slice(0, 300);
  // xAI has returned an auth failure as HTTP 400 with an "invalid-argument" code in practice
  // (not just HTTP 401) — key off the message text too, not just the status.
  if (status === 401 || /api key/i.test(body.message)) {
    return new AppError('INVALID_API_KEY', 'The xAI API key was rejected.', details, 401);
  }
  if (body.code === 'invalid_argument' || body.code === 'invalid-argument' || status === 400)
    return new AppError('VALIDATION_ERROR', `xAI rejected the request (HTTP ${status}).`, details, status);
  if (body.code === 'permission_denied' || status === 403)
    return new AppError('INVALID_API_KEY', 'The xAI API key does not have permission for this request.', details, 403);
  if (status === 429)
    return new AppError('PROVIDER_UNAVAILABLE', 'xAI rate-limited this request. Please try again shortly.', details, 429);
  if (body.code === 'service_unavailable' || status >= 500)
    return new AppError('PROVIDER_UNAVAILABLE', 'xAI is currently unavailable. Please try again shortly.', details, 502);
  return new AppError('UNKNOWN_ERROR', `The video generation request failed (HTTP ${status}).`, details, status);
}

async function submitVideoGeneration(params: XaiVideoGenerateParams): Promise<string> {
  const apiKey = getApiKey();
  const endpoint = `${BASE_URL}/v1/videos/generations`;

  const model = params.model || DEFAULT_MODEL;
  const requestBody: Record<string, unknown> = {
    model,
    prompt: params.prompt,
    duration: params.durationSeconds,
    resolution: params.resolution || DEFAULT_RESOLUTION,
  };
  if (params.imageBase64) {
    // image.url accepts either a public HTTPS URL or a base64 data URI —
    // confirmed in xAI's REST API reference (2026-08-25).
    requestBody.image = { url: `data:${params.imageMimeType || 'image/png'};base64,${params.imageBase64}` };
  }

  xaiLogger.log(
    `Video request created (model=${model}, duration=${params.durationSeconds}s, resolution=${requestBody.resolution}, hasImage=${Boolean(params.imageBase64)})`
  );

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const classified = classifyNetworkError(err);
    xaiLogger.error('Network error submitting video generation', { url: endpoint, ...classified });
    throw new AppError('PROVIDER_UNAVAILABLE', `Could not reach xAI (${classified.kind}).`, `${classified.kind}: ${classified.message}`, 502);
  }

  if (!res.ok) {
    const body = await parseErrorBody(res);
    xaiLogger.error('xAI rejected the video generation request', { status: res.status, ...body });
    throw mapHttpError(res.status, body);
  }

  const data = (await res.json()) as { request_id: string };
  xaiLogger.log(`Request ID: ${data.request_id}`);
  return data.request_id;
}

async function pollVideoResult(
  requestId: string,
  onStatus?: (status: string) => void
): Promise<{ videoUrl: string; costUsd: number | null }> {
  const apiKey = getApiKey();
  const endpoint = `${BASE_URL}/v1/videos/${requestId}`;
  const startedAt = Date.now();
  let delay = POLL_START_DELAY_MS;

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    let res: Response;
    try {
      res = await fetch(endpoint, { headers: authHeaders(apiKey), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      const classified = classifyNetworkError(err);
      xaiLogger.error('Network error polling video status', { url: endpoint, ...classified });
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        `Lost connection to xAI while polling (${classified.kind}).`,
        `${classified.kind}: ${classified.message}`,
        502
      );
    }

    if (!res.ok) {
      const body = await parseErrorBody(res);
      xaiLogger.error('xAI returned an error while polling', { status: res.status, ...body });
      throw mapHttpError(res.status, body);
    }

    const data = (await res.json()) as {
      status: 'pending' | 'done' | 'failed' | 'expired';
      video?: { url: string };
      error?: { code?: string; message?: string };
      usage?: { cost_in_usd_ticks?: number };
    };

    onStatus?.(data.status);

    if (data.status === 'done' && data.video) {
      xaiLogger.log('Video generation completed');
      // 100,000,000 ticks = $0.01 (confirmed in xAI's REST API reference).
      const costUsd = typeof data.usage?.cost_in_usd_ticks === 'number' ? data.usage.cost_in_usd_ticks / 1e10 : null;
      return { videoUrl: data.video.url, costUsd };
    }
    if (data.status === 'failed' || data.status === 'expired') {
      throw new AppError('GENERATION_FAILED', 'xAI failed to generate the video.', data.error?.message, 502);
    }

    xaiLogger.log(`Processing (status=${data.status})`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * POLL_BACKOFF_FACTOR, POLL_MAX_DELAY_MS);
  }

  throw new AppError('GENERATION_TIMEOUT', 'The video took too long to generate.', `Exceeded ${POLL_TIMEOUT_MS}ms polling timeout`, 504);
}

async function downloadVideo(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (err) {
    const classified = classifyNetworkError(err);
    xaiLogger.error('Network error downloading result video', { url, ...classified });
    throw new AppError(
      'RESULT_VIDEO_UNAVAILABLE',
      `Could not download the generated video (${classified.kind}).`,
      `${classified.kind}: ${classified.message}`,
      502
    );
  }
  if (!res.ok) {
    xaiLogger.error('Result video URL returned an error', { url, status: res.status, statusText: res.statusText });
    throw new AppError('RESULT_VIDEO_UNAVAILABLE', 'The generated video is no longer available.', `HTTP ${res.status} ${res.statusText}`, 502);
  }
  const contentType = res.headers.get('content-type') || 'video/mp4';
  const arrayBuffer = await res.arrayBuffer();
  xaiLogger.log('Result video downloaded');
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

export async function generateVideo(params: XaiVideoGenerateParams): Promise<XaiVideoGenerateResult> {
  const requestId = await submitVideoGeneration(params);
  const { videoUrl, costUsd } = await pollVideoResult(requestId, params.onProviderStatus);
  const { buffer, contentType } = await downloadVideo(videoUrl);
  return { videoBuffer: buffer, contentType, requestId, durationSeconds: params.durationSeconds, costUsd };
}
