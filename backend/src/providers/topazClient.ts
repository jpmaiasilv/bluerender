import { topazLogger } from '../lib/logger';
import { AppError } from '../lib/errors';
import { getTopazApiKey, TOPAZ_API_BASE_URL, TOPAZ_MODEL } from '../config/topaz';

/**
 * Topaz Labs Image API client ("High Fidelity V2" / Enhance, async flow).
 *
 * Confirmed against the official docs at developer.topazlabs.com (Image API
 * reference, read 2026-09-22) — endpoints, auth, fields and limits below are
 * not guessed. See config/topaz.ts for the exact source notes.
 *
 * NEVER logs the API key, the image bytes, or any base64 payload — only
 * process ids, status strings and byte counts.
 */

const CREATE_TIMEOUT_MS = 60_000;
const STATUS_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const CANCEL_TIMEOUT_MS = 15_000;

export type TopazRemoteStatus = 'Pending' | 'Processing' | 'Completed' | 'Cancelled' | 'Failed';

export interface TopazEnhanceParams {
  imageBuffer: Buffer;
  inputMime: 'image/jpeg' | 'image/png';
  outputWidth: number;
  outputHeight: number;
  outputFormat: 'jpeg' | 'png';
}

export interface TopazEnhanceJob {
  processId: string;
  sourceId: string | null;
  eta: number | null;
}

export interface TopazStatusResult {
  status: TopazRemoteStatus;
  progress: number | null;
}

/** Same cause-chain walk used by the other providers (BFL/xAI) — kept as its own copy so no provider's network-error handling can regress another. */
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
  return { kind: code || name || 'NETWORK_ERROR', message };
}

function authHeaders(): Record<string, string> {
  return { 'X-API-Key': getTopazApiKey() };
}

async function parseErrorBody(res: Response): Promise<{ message: string; raw: string }> {
  const raw = await res.text().catch(() => '');
  try {
    const data = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
    if (typeof data.error === 'string') return { message: data.error, raw };
    return { message: data.error?.message ?? data.message ?? res.statusText, raw };
  } catch {
    // Never log raw bytes if this turns out to be binary — cap what we keep.
    return { message: res.statusText, raw: raw.slice(0, 300) };
  }
}

function mapHttpError(status: number, body: { message: string; raw: string }): AppError {
  const details = body.message || body.raw;
  if (status === 401 || status === 403) return new AppError('INVALID_API_KEY', 'The Topaz API key was rejected.', details, status);
  if (status === 413) return new AppError('FILE_TOO_LARGE', 'The image is too large for Topaz to process.', details, 413);
  if (status === 429) return new AppError('PROVIDER_UNAVAILABLE', 'Topaz rate-limited this request. Please try again shortly.', details, 429);
  if (status === 400 || status === 422) return new AppError('VALIDATION_ERROR', `Topaz rejected the request (HTTP ${status}).`, details, status);
  if (status >= 500) return new AppError('PROVIDER_UNAVAILABLE', 'Topaz is currently unavailable. Please try again shortly.', details, 502);
  return new AppError('UNKNOWN_ERROR', `The upscale request failed (HTTP ${status}).`, details, status);
}

export async function createEnhanceJob(params: TopazEnhanceParams): Promise<TopazEnhanceJob> {
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(params.imageBuffer)], { type: params.inputMime }), `input.${params.inputMime === 'image/png' ? 'png' : 'jpg'}`);
  form.append('model', TOPAZ_MODEL);
  form.append('output_width', String(params.outputWidth));
  form.append('output_height', String(params.outputHeight));
  form.append('output_format', params.outputFormat);
  form.append('crop_to_fill', 'false');
  form.append('faceEnhancement', 'false');

  topazLogger.log(`Enhance request created (model=${TOPAZ_MODEL}, output=${params.outputWidth}x${params.outputHeight}, bytes=${params.imageBuffer.length})`);

  let res: Response;
  try {
    res = await fetch(`${TOPAZ_API_BASE_URL}/enhance/async`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
      signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
    });
  } catch (err) {
    const classified = classifyNetworkError(err);
    topazLogger.error('Network error creating enhance job', classified);
    throw new AppError('PROVIDER_UNAVAILABLE', `Could not reach Topaz (${classified.kind}).`, `${classified.kind}: ${classified.message}`, 502);
  }

  if (!res.ok) {
    const body = await parseErrorBody(res);
    topazLogger.error('Topaz rejected the enhance request', { status: res.status, message: body.message });
    throw mapHttpError(res.status, body);
  }

  const data = (await res.json()) as { process_id: string; source_id?: string; eta?: number };
  topazLogger.log(`Process ID: ${data.process_id}`);
  return { processId: data.process_id, sourceId: data.source_id ?? null, eta: typeof data.eta === 'number' ? data.eta : null };
}

export async function getEnhanceStatus(processId: string): Promise<TopazStatusResult> {
  let res: Response;
  try {
    res = await fetch(`${TOPAZ_API_BASE_URL}/status/${encodeURIComponent(processId)}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
  } catch (err) {
    const classified = classifyNetworkError(err);
    topazLogger.error('Network error polling Topaz status', { processId, ...classified });
    throw new AppError('PROVIDER_UNAVAILABLE', `Lost connection to Topaz while polling (${classified.kind}).`, `${classified.kind}: ${classified.message}`, 502);
  }

  if (!res.ok) {
    const body = await parseErrorBody(res);
    topazLogger.error('Topaz returned an error while polling status', { processId, status: res.status, message: body.message });
    throw mapHttpError(res.status, body);
  }

  const data = (await res.json()) as { status: TopazRemoteStatus; progress?: number };
  return { status: data.status, progress: typeof data.progress === 'number' ? data.progress : null };
}

export async function downloadEnhanceResult(processId: string): Promise<Buffer> {
  let res: Response;
  // GET /download/{process_id} does NOT return the image bytes directly — it
  // returns JSON with a presigned { download_url, head_url, expiry }, and the
  // actual image has to be fetched from download_url as a second request.
  // Confirmed against the official docs (developer.topazlabs.com) after this
  // was first implemented as a single-step binary download and produced a
  // tiny, unparseable "result" (the JSON envelope itself, mistaken for image
  // bytes) — see the run-real-topaz-test.ts report for the live repro.
  try {
    res = await fetch(`${TOPAZ_API_BASE_URL}/download/${encodeURIComponent(processId)}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    const classified = classifyNetworkError(err);
    topazLogger.error('Network error requesting Topaz download URL', { processId, ...classified });
    throw new AppError('RESULT_IMAGE_UNAVAILABLE', `Could not reach Topaz to request the result (${classified.kind}).`, `${classified.kind}: ${classified.message}`, 502);
  }

  if (!res.ok) {
    const body = await parseErrorBody(res);
    topazLogger.error('Topaz rejected the download URL request', { processId, status: res.status, message: body.message });
    throw mapHttpError(res.status, body);
  }

  const envelope = (await res.json()) as { download_url?: string; head_url?: string; expiry?: number };
  if (!envelope.download_url) {
    topazLogger.error('Topaz download response had no download_url', { processId });
    throw new AppError('RESULT_IMAGE_UNAVAILABLE', 'Topaz did not return a download link for this result.', undefined, 502);
  }

  let fileRes: Response;
  try {
    fileRes = await fetch(envelope.download_url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (err) {
    const classified = classifyNetworkError(err);
    topazLogger.error('Network error fetching Topaz result from the presigned URL', { processId, ...classified });
    throw new AppError('RESULT_IMAGE_UNAVAILABLE', `Could not download the Topaz result (${classified.kind}).`, `${classified.kind}: ${classified.message}`, 502);
  }
  if (!fileRes.ok) {
    topazLogger.error('The presigned Topaz download URL rejected the request', { processId, status: fileRes.status });
    throw new AppError('RESULT_IMAGE_UNAVAILABLE', `The Topaz result link returned HTTP ${fileRes.status}.`, undefined, 502);
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  topazLogger.log(`Result downloaded (bytes=${arrayBuffer.byteLength})`);
  return Buffer.from(arrayBuffer);
}

/** Best-effort — used by the TTL sweep to stop billing/processing on Topaz's side for jobs we've given up on. Never throws; a failed cancel just leaves the job to finish and be discarded unread. */
export async function cancelEnhanceJob(processId: string): Promise<void> {
  try {
    await fetch(`${TOPAZ_API_BASE_URL}/cancel/${encodeURIComponent(processId)}`, {
      method: 'DELETE',
      headers: authHeaders(),
      signal: AbortSignal.timeout(CANCEL_TIMEOUT_MS),
    });
  } catch (err) {
    const classified = classifyNetworkError(err);
    topazLogger.error('Failed to cancel Topaz job (best-effort, ignored)', { processId, ...classified });
  }
}
