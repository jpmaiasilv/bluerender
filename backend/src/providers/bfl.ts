import { bflLogger } from '../lib/logger';
import { AppError } from '../lib/errors';
import { GenerateRenderParams, GenerateRenderResult, RenderProvider } from './types';

/**
 * Black Forest Labs FLUX API integration.
 *
 * Reference: official BFL API skill (github.com/black-forest-labs/skills, skills/bfl-api).
 * Flow: POST /v1/{model} -> { id, polling_url } -> GET polling_url until status
 * is "Ready" (result.sample) or "Error". Result URLs expire after 10 minutes,
 * so we download the bytes immediately instead of linking to them.
 */

const BASE_URL = process.env.BFL_BASE_URL || 'https://api.bfl.ai';
const POLL_TIMEOUT_MS = Number(process.env.BFL_POLL_TIMEOUT_MS) || 180_000;
const POLL_START_DELAY_MS = 1000;
const POLL_MAX_DELAY_MS = 5000;
const POLL_BACKOFF_FACTOR = 1.5;

// BFL's official skills repo (github.com/black-forest-labs/skills) documents the
// pinned/stable path as /v1/flux-2-pro. BFL's own Playground "view code" currently
// generates requests against /v1/flux-2-pro-preview (the continuously-updated
// variant) instead — that's the fresher, production-observed signal, so it's the
// default here. Override with BFL_FLUX2_PRO_PATH if BFL renames or deprecates it.
// Klein 4B/9B paths were confirmed live directly against api.bfl.ai (no -preview
// variant needed — flux-2-klein-4b-preview 404s, flux-2-klein-4b doesn't) and
// match the skills repo exactly.
const MODEL_PATHS: Record<string, string> = {
  'flux-2-pro': process.env.BFL_FLUX2_PRO_PATH || '/v1/flux-2-pro-preview',
  'flux-2-klein-4b': '/v1/flux-2-klein-4b',
  'flux-2-klein-9b': '/v1/flux-2-klein-9b',
};

const DEFAULT_SAFETY_TOLERANCE = 2;
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Node's native fetch throws a generic `TypeError: fetch failed` with the real
 * OS/TLS-level reason nested in `.cause` (possibly several levels deep). Walking
 * the cause chain is required to tell DNS failures, connection resets, refused
 * connections and timeouts apart instead of collapsing them all into one opaque
 * "fetch failed" message.
 */
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
  if (code?.startsWith('CERT_') || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || /certificate|SSL|TLS/i.test(message)) {
    return { kind: 'TLS_ERROR', message };
  }
  return { kind: code || name || 'NETWORK_ERROR', message };
}

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

function logHttpError(context: string, url: string, method: string, res: Response, body: { code?: string; message: string; raw: string }): void {
  bflLogger.error(context, {
    url,
    method,
    status: res.status,
    statusText: res.statusText,
    bflErrorCode: body.code,
    bflMessage: body.message,
    bodyPreview: body.raw.slice(0, 500),
  });
}

function mapHttpError(status: number, body: { code?: string; message: string; raw: string }): AppError {
  const details = body.code ? `${body.code}: ${body.message}` : body.message || body.raw.slice(0, 300);
  if (status === 401) return new AppError('INVALID_API_KEY', 'The BFL API key was rejected.', details, 401);
  if (status === 402)
    return new AppError('INSUFFICIENT_CREDITS', 'Your BFL account does not have enough credits.', details, 402);
  if (status === 400 || status === 422)
    return new AppError('VALIDATION_ERROR', `BFL rejected the request (HTTP ${status}).`, details, status);
  if (status === 404)
    return new AppError(
      'PROVIDER_UNAVAILABLE',
      'The BFL model endpoint was not found (HTTP 404) — the model path is likely wrong or has changed.',
      details,
      404
    );
  if (status === 429)
    return new AppError('PROVIDER_UNAVAILABLE', 'Black Forest Labs rate-limited this request. Please try again shortly.', details, 429);
  if (status >= 500)
    return new AppError(
      'PROVIDER_UNAVAILABLE',
      'Black Forest Labs is currently unavailable. Please try again shortly.',
      details,
      502
    );
  return new AppError('UNKNOWN_ERROR', `The generation request failed (HTTP ${status}).`, details, status);
}

async function submitGeneration(
  modelId: string,
  params: GenerateRenderParams
): Promise<{ id: string; pollingUrl: string }> {
  const apiKey = getApiKey();
  const path = MODEL_PATHS[modelId];
  if (!path) {
    throw new AppError('PROVIDER_UNAVAILABLE', `Unknown FLUX model: ${modelId}`, undefined, 400);
  }

  const endpoint = `${BASE_URL}${path}`;
  bflLogger.log('Upload started');
  bflLogger.log(`Request created (model=${modelId}, ${params.width ?? 'auto'}x${params.height ?? 'auto'})`);

  // BFL's I2I endpoints accept multiple reference images via input_image, input_image_2
  // ... input_image_8 (confirmed in BFL's official skills repo, references/endpoints.md —
  // "Multi-Reference I2I"). input_image_2 here is the optional Reference Render.
  // input_image itself is optional too — omitting it is what makes this a pure
  // text-to-image request (all FLUX.2 models support prompt-only generation).
  const requestBody: Record<string, unknown> = {
    prompt: params.prompt,
    output_format: params.outputFormat,
    safety_tolerance: DEFAULT_SAFETY_TOLERANCE,
    // Keep the prompt exactly as built by promptBuilder — BFL's automatic prompt
    // upsampling would rewrite/expand it, undermining the architecture-preservation
    // instructions it contains.
    prompt_upsampling: false,
  };
  if (params.imageBase64) {
    requestBody.input_image = params.imageBase64;
  }
  if (params.referenceImageBase64) {
    requestBody.input_image_2 = params.referenceImageBase64;
  }
  if (params.width !== undefined && params.height !== undefined) {
    requestBody.width = params.width;
    requestBody.height = params.height;
  }

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
    bflLogger.error('Network error submitting generation', {
      url: endpoint,
      method: 'POST',
      errorKind: classified.kind,
      errorMessage: classified.message,
    });
    throw new AppError(
      'PROVIDER_UNAVAILABLE',
      `Could not reach Black Forest Labs (${classified.kind}).`,
      `${classified.kind}: ${classified.message}`,
      502
    );
  }

  if (!res.ok) {
    const body = await parseErrorBody(res);
    logHttpError('BFL rejected the generation request', endpoint, 'POST', res, body);
    throw mapHttpError(res.status, body);
  }

  const data = (await res.json()) as { id: string; polling_url: string };
  bflLogger.log(`Request ID: ${data.id}`);
  return { id: data.id, pollingUrl: data.polling_url };
}

async function pollResult(
  pollingUrl: string,
  onStatus?: (status: string) => void
): Promise<{ sampleUrl: string; seed?: number }> {
  const apiKey = getApiKey();
  const startedAt = Date.now();
  let delay = POLL_START_DELAY_MS;

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    let res: Response;
    try {
      res = await fetch(pollingUrl, { headers: authHeaders(apiKey), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      const classified = classifyNetworkError(err);
      bflLogger.error('Network error polling generation status', {
        url: pollingUrl,
        method: 'GET',
        errorKind: classified.kind,
        errorMessage: classified.message,
      });
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        `Lost connection to Black Forest Labs while polling (${classified.kind}).`,
        `${classified.kind}: ${classified.message}`,
        502
      );
    }

    if (!res.ok) {
      const body = await parseErrorBody(res);
      logHttpError('BFL returned an error while polling', pollingUrl, 'GET', res, body);
      throw mapHttpError(res.status, body);
    }

    const data = (await res.json()) as {
      status: string;
      result?: { sample: string; seed?: number };
      error?: string;
    };

    onStatus?.(data.status);

    if (data.status === 'Ready' && data.result) {
      bflLogger.log('Completed');
      return { sampleUrl: data.result.sample, seed: data.result.seed };
    }
    if (data.status === 'Error') {
      throw new AppError('GENERATION_FAILED', 'Black Forest Labs failed to generate the render.', data.error, 502);
    }

    bflLogger.log(`Processing (status=${data.status})`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * POLL_BACKOFF_FACTOR, POLL_MAX_DELAY_MS);
  }

  throw new AppError(
    'GENERATION_TIMEOUT',
    'The render took too long to generate.',
    `Exceeded ${POLL_TIMEOUT_MS}ms polling timeout`,
    504
  );
}

async function downloadResultImage(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    const classified = classifyNetworkError(err);
    bflLogger.error('Network error downloading result image', {
      url,
      method: 'GET',
      errorKind: classified.kind,
      errorMessage: classified.message,
    });
    throw new AppError(
      'RESULT_IMAGE_UNAVAILABLE',
      `Could not download the generated image (${classified.kind}).`,
      `${classified.kind}: ${classified.message}`,
      502
    );
  }
  if (!res.ok) {
    bflLogger.error('Result image URL returned an error', { url, status: res.status, statusText: res.statusText });
    throw new AppError(
      'RESULT_IMAGE_UNAVAILABLE',
      'The generated image is no longer available.',
      `HTTP ${res.status} ${res.statusText} from result URL`,
      502
    );
  }
  const contentType = res.headers.get('content-type') || 'image/png';
  const arrayBuffer = await res.arrayBuffer();
  bflLogger.log('Result downloaded');
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

export const bflProvider: RenderProvider = {
  id: 'bfl',
  label: 'Black Forest Labs',
  // Credit pricing per engine tier lives in config/engines.ts, not here — this
  // list only declares which models this provider actually supports.
  models: [
    { id: 'flux-2-klein-4b', label: 'FLUX.2 Klein 4B' },
    { id: 'flux-2-klein-9b', label: 'FLUX.2 Klein 9B' },
    { id: 'flux-2-pro', label: 'FLUX.2 Pro' },
  ],
  async generateRender(modelId: string, params: GenerateRenderParams): Promise<GenerateRenderResult> {
    const { id, pollingUrl } = await submitGeneration(modelId, params);
    const { sampleUrl, seed } = await pollResult(pollingUrl, params.onProviderStatus);
    const { buffer, contentType } = await downloadResultImage(sampleUrl);
    return { imageBuffer: buffer, contentType, requestId: id, seed };
  },
};
