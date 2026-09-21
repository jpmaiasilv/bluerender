import OpenAI from 'openai';
import { AppError } from './errors';

/**
 * One place that turns an OpenAI SDK failure into (a) a SAFE diagnostic record
 * that keeps the ORIGINAL status / code / type / request id / message, and
 * (b) an AppError with an honest classification.
 *
 * Why it exists: 401/403 used to be reported as "invalid API key" whatever
 * the reason, and the original OpenAI message was thrown away, so a failure
 * could not be diagnosed afterwards. Now only OpenAI's own `invalid_api_key`
 * code means "bad key"; permission, model-access, region and unknown-model
 * problems are reported as what they are (and always logged with their code).
 *
 * Nothing here ever includes the API key, request headers, or image data:
 * key-shaped strings and long base64 blobs are redacted from the message.
 */

export interface OpenAiErrorInfo {
  status: number | null;
  code: string | null;
  type: string | null;
  param: string | null;
  requestId: string | null;
  /** Original OpenAI message, redacted and truncated. */
  message: string;
  isTimeout: boolean;
  isConnection: boolean;
}

export function redactSecrets(text: string, max = 400): string {
  return text
    .replace(/sk-[A-Za-z0-9_\-*.]{4,}/g, (m) => `${m.slice(0, 5)}…[redacted]`)
    .replace(/Bearer\s+[A-Za-z0-9_\-.=]+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9+/]{80,}={0,2}/g, '[base64-redacted]')
    .slice(0, max);
}

export function describeOpenAiError(err: unknown): OpenAiErrorInfo {
  if (err instanceof OpenAI.APIError) {
    const body = (err.error ?? {}) as { code?: unknown; type?: unknown; param?: unknown; message?: unknown };
    return {
      status: typeof err.status === 'number' ? err.status : null,
      code: typeof err.code === 'string' ? err.code : typeof body.code === 'string' ? body.code : null,
      type: typeof err.type === 'string' ? err.type : typeof body.type === 'string' ? body.type : null,
      param: typeof err.param === 'string' ? err.param : typeof body.param === 'string' ? body.param : null,
      requestId: err.requestID ?? null,
      message: redactSecrets(typeof body.message === 'string' ? body.message : err.message ?? ''),
      isTimeout: err instanceof OpenAI.APIConnectionTimeoutError,
      isConnection: err instanceof OpenAI.APIConnectionError,
    };
  }
  return { status: null, code: null, type: null, param: null, requestId: null, message: redactSecrets(err instanceof Error ? err.message : String(err)), isTimeout: false, isConnection: false };
}

export type OpenAiFailureKind = 'invalid_api_key' | 'access_denied' | 'model_unavailable' | 'rate_limited' | 'bad_request' | 'server_error' | 'timeout' | 'connection' | 'unknown';

/** What actually went wrong, judged from OpenAI's own status + code. */
export function classifyKind(info: OpenAiErrorInfo): OpenAiFailureKind {
  if (info.isTimeout) return 'timeout';
  if (info.isConnection && info.status === null) return 'connection';
  const code = info.code ?? '';
  if (code === 'invalid_api_key') return 'invalid_api_key';
  if (info.status === 401 && code === '') return 'invalid_api_key'; // a bare 401 with no code is still an authentication failure
  if (info.status === 401 || info.status === 403) return 'access_denied'; // permissions / scopes / model access / region / org verification
  if (info.status === 404 || code === 'model_not_found') return 'model_unavailable';
  if (info.status === 429) return 'rate_limited';
  if (info.status === 400 || info.status === 422) return 'bad_request';
  if (typeof info.status === 'number' && info.status >= 500) return 'server_error';
  return 'unknown';
}

/**
 * The AppError for a failure. Only `invalid_api_key` becomes INVALID_API_KEY.
 * `details` carries the SAFE diagnostic string (status/code/type/request id),
 * which the routes never send to the browser but the pipeline stores.
 */
export function toAppError(info: OpenAiErrorInfo, what: string): AppError {
  const kind = classifyKind(info);
  const details = `status=${info.status ?? 'n/a'} code=${info.code ?? 'n/a'} type=${info.type ?? 'n/a'} requestId=${info.requestId ?? 'n/a'}`;
  switch (kind) {
    case 'invalid_api_key':
      return new AppError('INVALID_API_KEY', 'The OpenAI API key was rejected.', details, 401);
    case 'access_denied':
      return new AppError('PROVIDER_UNAVAILABLE', `OpenAI denied access for ${what} (permissions, model access or region).`, details, 403);
    case 'model_unavailable':
      return new AppError('PROVIDER_UNAVAILABLE', `The model for ${what} is not available to this account.`, details, 404);
    case 'rate_limited':
      return new AppError('PROVIDER_UNAVAILABLE', 'OpenAI rate-limited this request.', details, 429);
    case 'bad_request':
      return new AppError('VALIDATION_ERROR', `OpenAI rejected the ${what} request (HTTP ${info.status}).`, details, info.status ?? 400);
    case 'server_error':
      return new AppError('PROVIDER_UNAVAILABLE', 'OpenAI is currently unavailable.', details, 502);
    case 'timeout':
      return new AppError('GENERATION_TIMEOUT', `The ${what} request timed out.`, details, 504);
    case 'connection':
      return new AppError('PROVIDER_UNAVAILABLE', 'Could not reach OpenAI.', details, 502);
    default:
      return new AppError('UNKNOWN_ERROR', `The ${what} request failed.`, details, 500);
  }
}

/** Fields safe to write to the server log: the original OpenAI diagnosis, redacted. */
export function logFields(info: OpenAiErrorInfo, model: string): Record<string, unknown> {
  return { model, status: info.status ?? 'n/a', code: info.code, type: info.type, param: info.param, requestId: info.requestId, message: info.message, kind: classifyKind(info) };
}
