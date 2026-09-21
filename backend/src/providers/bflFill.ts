import { bflLogger } from '../lib/logger';
import { AppError } from '../lib/errors';

/**
 * Black Forest Labs FLUX.1 Fill integration — used ONLY by Planta
 * Humanizada's Fill pipeline (routes/generateHumanizedFloorplan.ts).
 *
 * Deliberately NOT sharing code with providers/bfl.ts (the FLUX.2
 * integration every other tool uses): per explicit requirement, the
 * existing Render/Redesign/Vídeo/Upscale endpoints must not be touched or
 * risked, and FLUX.1 Fill must stay confined to this one module. The
 * polling/error-classification logic below is intentionally a parallel,
 * independent copy of the same proven pattern from bfl.ts rather than an
 * extracted shared helper, so a change here can never affect the other
 * tools and vice versa.
 */

const BASE_URL = process.env.BFL_BASE_URL || 'https://api.bfl.ai';
const FILL_PATH = '/v1/flux-pro-1.0-fill';
const POLL_TIMEOUT_MS = Number(process.env.BFL_POLL_TIMEOUT_MS) || 180_000;
const POLL_START_DELAY_MS = 1000;
const POLL_MAX_DELAY_MS = 5000;
const POLL_BACKOFF_FACTOR = 1.5;
const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_SAFETY_TOLERANCE = 2;

export interface FillRequestParams {
  prompt: string;
  imageBase64: string;
  maskBase64: string;
  steps?: number;
  guidance?: number;
  outputFormat: 'png' | 'jpeg';
  onProviderStatus?: (status: string) => void;
}

export interface FillResult {
  imageBuffer: Buffer;
  contentType: string;
  requestId: string;
  seed?: number;
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

  if (name === 'AbortError' || name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT') return { kind: 'TIMEOUT', message };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { kind: 'DNS_RESOLUTION_FAILED', message };
  if (code === 'ECONNREFUSED') return { kind: 'CONNECTION_REFUSED', message };
  if (code === 'ECONNRESET') return { kind: 'CONNECTION_RESET', message };
  if (code?.startsWith('CERT_') || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || /certificate|SSL|TLS/i.test(message)) {
    return { kind: 'TLS_ERROR', message };
  }
  return { kind: code || name || 'NETWORK_ERROR', message };
}

/** Reads BFL_API_KEY only from process.env, only at call time — never logged, never included in any error message or response sent to the frontend. Same key the FLUX.2 integration already uses (see the Planta Humanizada Fill audit — this is the one deliberate point of overlap: the secret, not the code path). */
function getApiKey(): string {
  const key = process.env.BFL_API_KEY;
  if (!key) {
    throw new AppError(
      'INVALID_API_KEY',
      'BFL_API_KEY is not configured on the server.',
      'Add BFL_API_KEY to backend/.env and restart the server.',
      500
    );
  }
  return key;
}

function authHeaders(apiKey: string): Record<string, string> {
  return { 'x-key': apiKey, 'Content-Type': 'application/json' };
}

async function parseErrorBody(res: Response): Promise<{ code?: string; message: string; raw: string }> {
  const raw = await res.text();
  try {
    const data = JSON.parse(raw) as { error?: string; message?: string };
    return { code: data.error, message: data.message || res.statusText, raw };
  } catch {
    return { message: res.statusText, raw };
  }
}

function mapHttpError(status: number, body: { code?: string; message: string; raw: string }): AppError {
  const details = body.code ? `${body.code}: ${body.message}` : body.message || body.raw.slice(0, 300);
  if (status === 401) return new AppError('INVALID_API_KEY', 'The BFL API key was rejected.', details, 401);
  if (status === 402) return new AppError('INSUFFICIENT_CREDITS', 'Your BFL account does not have enough credits.', details, 402);
  if (status === 400 || status === 422) return new AppError('VALIDATION_ERROR', `BFL rejected the Fill request (HTTP ${status}).`, details, status);
  if (status === 404) return new AppError('PROVIDER_UNAVAILABLE', 'The FLUX.1 Fill endpoint was not found (HTTP 404).', details, 404);
  if (status === 429) return new AppError('PROVIDER_UNAVAILABLE', 'Black Forest Labs rate-limited this request. Please try again shortly.', details, 429);
  if (status >= 500) return new AppError('PROVIDER_UNAVAILABLE', 'Black Forest Labs is currently unavailable. Please try again shortly.', details, 502);
  return new AppError('UNKNOWN_ERROR', `The Fill request failed (HTTP ${status}).`, details, status);
}

async function submitFill(params: FillRequestParams): Promise<{ id: string; pollingUrl: string }> {
  const apiKey = getApiKey();
  const endpoint = `${BASE_URL}${FILL_PATH}`;

  const requestBody: Record<string, unknown> = {
    prompt: params.prompt,
    image: params.imageBase64,
    mask: params.maskBase64,
    output_format: params.outputFormat,
    safety_tolerance: DEFAULT_SAFETY_TOLERANCE,
  };
  if (params.steps !== undefined) requestBody.steps = params.steps;
  if (params.guidance !== undefined) requestBody.guidance = params.guidance;

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
    bflLogger.error('[Fill] Network error submitting Fill request', { url: endpoint, errorKind: classified.kind, errorMessage: classified.message });
    throw new AppError('PROVIDER_UNAVAILABLE', `Could not reach Black Forest Labs (${classified.kind}).`, `${classified.kind}: ${classified.message}`, 502);
  }

  if (!res.ok) {
    const body = await parseErrorBody(res);
    bflLogger.error('[Fill] BFL rejected the Fill request', { url: endpoint, status: res.status, bflMessage: body.message });
    throw mapHttpError(res.status, body);
  }

  const data = (await res.json()) as { id: string; polling_url: string };
  return { id: data.id, pollingUrl: data.polling_url };
}

async function pollFillResult(pollingUrl: string, onStatus?: (status: string) => void): Promise<{ sampleUrl: string; seed?: number }> {
  const apiKey = getApiKey();
  const startedAt = Date.now();
  let delay = POLL_START_DELAY_MS;

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    let res: Response;
    try {
      res = await fetch(pollingUrl, { headers: authHeaders(apiKey), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      const classified = classifyNetworkError(err);
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        `Lost connection to Black Forest Labs while polling (${classified.kind}).`,
        `${classified.kind}: ${classified.message}`,
        502
      );
    }

    if (!res.ok) {
      const body = await parseErrorBody(res);
      throw mapHttpError(res.status, body);
    }

    const data = (await res.json()) as { status: string; result?: { sample: string; seed?: number }; error?: string };
    onStatus?.(data.status);

    if (data.status === 'Ready' && data.result) {
      return { sampleUrl: data.result.sample, seed: data.result.seed };
    }
    if (data.status === 'Error') {
      throw new AppError('GENERATION_FAILED', 'Black Forest Labs failed to fill the floor plan.', data.error, 502);
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * POLL_BACKOFF_FACTOR, POLL_MAX_DELAY_MS);
  }

  throw new AppError('GENERATION_TIMEOUT', 'The Fill request took too long.', `Exceeded ${POLL_TIMEOUT_MS}ms polling timeout`, 504);
}

async function downloadResultImage(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    const classified = classifyNetworkError(err);
    throw new AppError(
      'RESULT_IMAGE_UNAVAILABLE',
      `Could not download the filled image (${classified.kind}).`,
      `${classified.kind}: ${classified.message}`,
      502
    );
  }
  if (!res.ok) {
    throw new AppError('RESULT_IMAGE_UNAVAILABLE', 'The filled image is no longer available.', `HTTP ${res.status} ${res.statusText}`, 502);
  }
  const contentType = res.headers.get('content-type') || 'image/png';
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

export async function generateFill(params: FillRequestParams): Promise<FillResult> {
  const startedAt = Date.now();
  const { id, pollingUrl } = await submitFill(params);
  const { sampleUrl, seed } = await pollFillResult(pollingUrl, params.onProviderStatus);
  const { buffer, contentType } = await downloadResultImage(sampleUrl);
  bflLogger.log('[Fill] Fill call completed', { requestId: id, elapsedMs: Date.now() - startedAt, bytes: buffer.length });
  return { imageBuffer: buffer, contentType, requestId: id, seed };
}
