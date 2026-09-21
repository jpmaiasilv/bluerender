import {
  ArchitectChatConfig,
  ArchitectChatConversationDetail,
  ArchitectChatConversationSummary,
  ArchitectChatStreamEvent,
  CreateJobResponse,
  EditorExportCreateJobResponse,
  EditorExportJobStatusResponse,
  EditorExportRequestProject,
  EditorMediaUploadResponse,
  EngineInfo,
  ErrorCode,
  HumanizedFloorplanConfigResponse,
  HumanizedFloorplanCreateJobResponse,
  HumanizedFloorplanJobStatusResponse,
  HumanizedFloorplanMaskResponse,
  HumanizedFloorplanGenerationMode,
  HumanizedFloorplanSimpleConfig,
  HumanizedFloorplanSimpleCreateJobResponse,
  HumanizedFloorplanSimpleHistoryItem,
  HumanizedFloorplanSimpleJobStatusResponse,
  HumanizedFloorplanSimpleSettings,
  IdeaCreateJobResponse,
  IdeaEngineInfo,
  IdeaGenerationMode,
  IdeaGeneratorSettings,
  IdeaJobStatusResponse,
  JobStatusResponse,
  PlantaCreateJobResponse,
  PlantaEngineInfo,
  PlantaHumanizadaSettings,
  PlantaJobStatusResponse,
  RenderSettings,
  T2ICreateJobResponse,
  T2IEngineInfo,
  T2IJobStatusResponse,
  TextToImageSettings,
  VideoCreateJobResponse,
  VideoGeneratorSettings,
  VideoJobStatusResponse,
  VideoPricingResponse,
} from '../types';
import { PlanId } from '../config/plans';
import { supabase } from './supabase';

const JOB_POLL_INTERVAL_MS = 1500;
const CLIENT_TIMEOUT_MS = 240_000; // slightly above the backend's own polling timeout
const VIDEO_CLIENT_TIMEOUT_MS = 330_000; // video generation runs longer — slightly above the backend's own 300s poll timeout

export class ApiError extends Error {
  code: ErrorCode;
  details?: string;

  constructor(code: ErrorCode, message: string, details?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

export async function fetchEngines(): Promise<EngineInfo[]> {
  const res = await fetch('/api/engines');
  if (!res.ok) {
    throw new ApiError('PROVIDER_UNAVAILABLE', 'Could not load available render engines.');
  }
  const data = (await res.json()) as { engines: EngineInfo[] };
  return data.engines;
}

/**
 * Every paid call and the wallet carry the signed-in user's Supabase access
 * token; the backend verifies it and derives the user from it — the browser
 * never says whose wallet to use. (Defined here as a function declaration so
 * the Planta Humanizada helpers further down share it.)
 */
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  const token = data.session?.access_token;
  if (!token) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue.');
  return { Authorization: `Bearer ${token}` };
}

export async function fetchWalletBalance(): Promise<number> {
  const res = await fetch('/api/wallet', { headers: await authHeaders() });
  if (!res.ok) throw new ApiError('UNKNOWN_ERROR', 'Could not load wallet balance.');
  const data = (await res.json()) as { balance: number };
  return data.balance;
}

/** DEV-ONLY: grants free test credits. */
export async function addTestCredits(): Promise<number> {
  const res = await fetch('/api/wallet/test-credits', { method: 'POST', headers: await authHeaders() });
  if (!res.ok) throw new ApiError('UNKNOWN_ERROR', 'Could not add test credits.');
  const data = (await res.json()) as { balance: number };
  return data.balance;
}

export async function submitGenerationJob(
  image: File,
  settings: RenderSettings,
  referenceImage?: File | null
): Promise<CreateJobResponse> {
  const form = new FormData();
  form.append('image', image);
  if (referenceImage) {
    form.append('referenceImage', referenceImage);
  }
  form.append('projectType', settings.projectType);
  form.append('preserveArchitecture', settings.preserveArchitecture);
  form.append('renderStyle', settings.renderStyle);
  form.append('lighting', settings.lighting);
  form.append('environment', settings.environment);
  form.append('led', settings.led);
  form.append('aspectRatio', settings.aspectRatio);
  form.append('engine', settings.engine);
  if (settings.customInstructions) {
    form.append('customInstructions', settings.customInstructions);
  }

  const res = await fetch('/api/generate', { method: 'POST', body: form, headers: await authHeaders() });
  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(
      data.error?.code ?? 'UNKNOWN_ERROR',
      data.error?.message ?? 'Failed to start generation.',
      data.error?.details
    );
  }
  return data as CreateJobResponse;
}

export async function pollJobUntilDone(
  jobId: string,
  onUpdate: (status: JobStatusResponse) => void,
  signal: AbortSignal
): Promise<JobStatusResponse> {
  const start = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal.aborted) {
      throw new ApiError('GENERATION_TIMEOUT', 'Generation was cancelled.');
    }
    if (Date.now() - start > CLIENT_TIMEOUT_MS) {
      throw new ApiError('GENERATION_TIMEOUT', 'The render is taking longer than expected.');
    }

    const res = await fetch(`/api/generate/${jobId}`, { signal });
    if (!res.ok) {
      throw new ApiError('UNKNOWN_ERROR', 'Lost track of the generation job.');
    }
    const data = (await res.json()) as JobStatusResponse;
    onUpdate(data);

    if (data.stage === 'complete') return data;
    if (data.stage === 'error') {
      throw new ApiError(data.error?.code ?? 'UNKNOWN_ERROR', data.error?.message ?? 'Generation failed.', data.error?.details);
    }

    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

// --- Planta Humanizada ---

export async function fetchPlantaEngines(): Promise<PlantaEngineInfo[]> {
  const res = await fetch('/api/planta-humanizada/engines');
  if (!res.ok) {
    throw new ApiError('PROVIDER_UNAVAILABLE', 'Could not load available engines.');
  }
  const data = (await res.json()) as { engines: PlantaEngineInfo[] };
  return data.engines;
}

export async function submitPlantaHumanizadaJob(
  image: File,
  settings: PlantaHumanizadaSettings,
  referenceImage?: File | null
): Promise<PlantaCreateJobResponse> {
  const form = new FormData();
  form.append('image', image);
  if (referenceImage) {
    form.append('referenceImage', referenceImage);
  }
  form.append('renderStyle', settings.renderStyle);
  form.append('engine', settings.engine);
  if (settings.customInstructions) {
    form.append('customInstructions', settings.customInstructions);
  }

  const res = await fetch('/api/planta-humanizada/generate', { method: 'POST', body: form, headers: await authHeaders() });
  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(
      data.error?.code ?? 'UNKNOWN_ERROR',
      data.error?.message ?? 'Failed to start generation.',
      data.error?.details
    );
  }
  return data as PlantaCreateJobResponse;
}

/** "Limpeza Técnica" — cleans up an already-generated Planta Humanizada image. Reuses pollPlantaHumanizadaJobUntilDone (same job map/shape on the backend). */
export async function submitPlantaCleanupJob(requestId: string): Promise<PlantaCreateJobResponse> {
  const res = await fetch('/api/planta-humanizada/cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ requestId }),
  });
  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(
      data.error?.code ?? 'UNKNOWN_ERROR',
      data.error?.message ?? 'Failed to start cleanup.',
      data.error?.details
    );
  }
  return data as PlantaCreateJobResponse;
}

export async function pollPlantaHumanizadaJobUntilDone(
  jobId: string,
  onUpdate: (status: PlantaJobStatusResponse) => void,
  signal: AbortSignal
): Promise<PlantaJobStatusResponse> {
  const start = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal.aborted) {
      throw new ApiError('GENERATION_TIMEOUT', 'Generation was cancelled.');
    }
    if (Date.now() - start > CLIENT_TIMEOUT_MS) {
      throw new ApiError('GENERATION_TIMEOUT', 'The render is taking longer than expected.');
    }

    const res = await fetch(`/api/planta-humanizada/generate/${jobId}`, { signal });
    if (!res.ok) {
      throw new ApiError('UNKNOWN_ERROR', 'Lost track of the generation job.');
    }
    const data = (await res.json()) as PlantaJobStatusResponse;
    onUpdate(data);

    if (data.stage === 'complete') return data;
    if (data.stage === 'error') {
      throw new ApiError(data.error?.code ?? 'UNKNOWN_ERROR', data.error?.message ?? 'Generation failed.', data.error?.details);
    }

    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

// --- Planta Humanizada: OpenCV mask + FLUX.1 Fill pipeline ---
// Deliberately its own section, calling /api/generate-humanized-floorplan*
// (never /api/planta-humanizada/*) — see backend/src/routes/generateHumanizedFloorplan.ts.
// The two endpoints below map 1:1 to that route's two POST handlers: the
// mask preview is free (no credits, no BFL call), the generate call is the
// only paid one and must always be preceded by the user reviewing/confirming
// that mask in MaskReviewScreen.

/** Single shared source of truth for the cost shown anywhere in the UI — never hardcode this number, always fetch it from here (see backend/src/config/humanizedFloorplanEngine.ts). */
export async function fetchHumanizedFloorplanConfig(): Promise<HumanizedFloorplanConfigResponse> {
  const res = await fetch('/api/generate-humanized-floorplan/config');
  const data = await res.json();
  if (!res.ok) {
    throw new ApiError(data.error?.code ?? 'UNKNOWN_ERROR', data.error?.message ?? 'Failed to load pricing.', data.error?.details);
  }
  return data as HumanizedFloorplanConfigResponse;
}

/** Free — runs only local OpenCV detection, no BFL call, no credits charged. */
export async function fetchHumanizedFloorplanMaskPreview(image: File): Promise<HumanizedFloorplanMaskResponse> {
  const form = new FormData();
  form.append('image', image);

  const res = await fetch('/api/generate-humanized-floorplan/mask', { method: 'POST', body: form });
  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(
      data.error?.code ?? 'UNKNOWN_ERROR',
      data.error?.message ?? 'Failed to build the mask preview.',
      data.error?.details
    );
  }
  return data as HumanizedFloorplanMaskResponse;
}

/**
 * Paid — starts the FLUX.1 Fill generation. `mask` must always be provided:
 * either the user's edited mask, or (if they made no edits) the exact same
 * auto-mask PNG fetchHumanizedFloorplanMaskPreview returned — the backend
 * never re-derives the mask on this call, so whatever is sent here is
 * exactly what gets used (see requirement: editing must not be silently
 * discarded).
 */
export async function submitHumanizedFloorplanGenerate(
  image: File,
  mask: Blob,
  prompt?: string
): Promise<HumanizedFloorplanCreateJobResponse> {
  const form = new FormData();
  form.append('image', image);
  form.append('maskOverride', mask, 'mask.png');
  if (prompt) {
    form.append('prompt', prompt);
  }

  const res = await fetch('/api/generate-humanized-floorplan', { method: 'POST', body: form, headers: await authHeaders() });
  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(
      data.error?.code ?? 'UNKNOWN_ERROR',
      data.error?.message ?? 'Failed to start generation.',
      data.error?.details
    );
  }
  return data as HumanizedFloorplanCreateJobResponse;
}

export async function pollHumanizedFloorplanJobUntilDone(
  jobId: string,
  onUpdate: (status: HumanizedFloorplanJobStatusResponse) => void,
  signal: AbortSignal
): Promise<HumanizedFloorplanJobStatusResponse> {
  const start = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal.aborted) {
      throw new ApiError('GENERATION_TIMEOUT', 'Generation was cancelled.');
    }
    if (Date.now() - start > CLIENT_TIMEOUT_MS) {
      throw new ApiError('GENERATION_TIMEOUT', 'The generation is taking longer than expected.');
    }

    const res = await fetch(`/api/generate-humanized-floorplan/${jobId}`, { signal });
    if (!res.ok) {
      throw new ApiError('UNKNOWN_ERROR', 'Lost track of the generation job.');
    }
    const data = (await res.json()) as HumanizedFloorplanJobStatusResponse;
    onUpdate(data);

    if (data.stage === 'complete') return data;
    if (data.stage === 'error') {
      throw new ApiError(data.error?.code ?? 'UNKNOWN_ERROR', data.error?.message ?? 'Generation failed.', data.error?.details);
    }

    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

// --- Planta Humanizada (primary flow) — authenticated: every call carries the
// user's Supabase access token, and the backend verifies it before touching
// credits, files or history. The cost shown anywhere comes from /config.

const SIMPLE_BASE = '/api/generate-humanized-floorplan-simple';
const SIMPLE_CLIENT_TIMEOUT_MS = 360_000; // above the backend's own 5-minute provider timeout, so the client never gives up before the server does

const simpleAuthHeaders = authHeaders;

async function readSimpleError(res: Response, fallback: string): Promise<ApiError> {
  let body: { error?: { code?: ErrorCode; message?: string } } = {};
  try {
    body = await res.json();
  } catch {
    // Non-JSON error body — fall through to the generic fallback.
  }
  return new ApiError(body.error?.code ?? 'UNKNOWN_ERROR', body.error?.message ?? fallback);
}

export async function fetchHumanizedFloorplanSimpleConfig(): Promise<HumanizedFloorplanSimpleConfig> {
  const res = await fetch(`${SIMPLE_BASE}/config`);
  if (!res.ok) throw await readSimpleError(res, 'Failed to load pricing.');
  return (await res.json()) as HumanizedFloorplanSimpleConfig;
}

export interface SimpleGenerateInput {
  /** New floor plan upload — omit when regenerating from a stored generation. */
  image: File | null;
  styleReference: File | null;
  settings: HumanizedFloorplanSimpleSettings;
  /** Unique per generation attempt (a "Gerar novamente" gets a fresh one); a repeated key returns the ORIGINAL generation instead of charging again. */
  idempotencyKey: string;
  /** 'standard' (Blue Render) or 'astra'. Only a label: the server decides what it costs. */
  generationMode: HumanizedFloorplanGenerationMode;
  /** Regenerate from the stored original of an earlier generation (own generations only, checked server-side). */
  sourceGenerationId?: string | null;
  reuseSourceReference?: boolean;
}

/**
 * The server keeps the plan's geometry by placing it, untouched, on a canvas with
 * neutral margins — which needs to decode the pixels. It decodes PNG/JPEG but not
 * WEBP, so a WEBP plan is converted to a lossless PNG here (same pixels, same
 * size) before upload. Anything that fails to convert is sent as-is.
 */
async function toServerReadableImage(file: File): Promise<File> {
  if (file.type !== 'image/webp') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? new File([blob], file.name.replace(/.webp$/i, '') + '.png', { type: 'image/png' }) : file;
  } catch {
    return file;
  }
}

/** Paid — starts one generation (credits reserved server-side, refunded automatically on any failure). */
export async function submitHumanizedFloorplanSimpleGenerate(input: SimpleGenerateInput): Promise<HumanizedFloorplanSimpleCreateJobResponse> {
  const s = input.settings;
  const form = new FormData();
  if (input.image) form.append('image', await toServerReadableImage(input.image));
  if (input.styleReference) form.append('styleReference', input.styleReference);
  form.append('style', s.style);
  form.append('generationMode', input.generationMode);
  form.append('lighting', s.lighting);
  form.append('surroundings', s.surroundings);
  if (s.surroundings === 'with') {
    form.append('surroundingsKind', s.surroundingsKind);
    if (s.surroundingsKind === 'custom' && s.customSurroundings.trim()) form.append('customSurroundings', s.customSurroundings.trim());
  }
  form.append('textMode', s.textMode);
  form.append('furnitureLevel', s.furnitureLevel);
  form.append('outputFormat', s.outputFormat);
  if (s.customInstructions.trim()) form.append('customInstructions', s.customInstructions.trim());
  form.append('idempotencyKey', input.idempotencyKey);
  if (input.sourceGenerationId) form.append('sourceGenerationId', input.sourceGenerationId);
  if (input.reuseSourceReference) form.append('reuseSourceReference', '1');

  const res = await fetch(SIMPLE_BASE, { method: 'POST', body: form, headers: await simpleAuthHeaders() });
  if (!res.ok) throw await readSimpleError(res, 'Failed to start generation.');
  return (await res.json()) as HumanizedFloorplanSimpleCreateJobResponse;
}

/** Read-only polling — never starts a generation or touches credits. */
export async function pollHumanizedFloorplanSimpleJobUntilDone(
  jobId: string,
  onUpdate: (status: HumanizedFloorplanSimpleJobStatusResponse) => void,
  signal: AbortSignal
): Promise<HumanizedFloorplanSimpleJobStatusResponse> {
  const start = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal.aborted) throw new ApiError('GENERATION_TIMEOUT', 'Generation was cancelled.');
    if (Date.now() - start > SIMPLE_CLIENT_TIMEOUT_MS) throw new ApiError('GENERATION_TIMEOUT', 'The generation is taking longer than expected.');

    const res = await fetch(`${SIMPLE_BASE}/${jobId}`, { signal, headers: await simpleAuthHeaders() });
    if (!res.ok) throw await readSimpleError(res, 'Lost track of the generation job.');
    const data = (await res.json()) as HumanizedFloorplanSimpleJobStatusResponse;
    onUpdate(data);

    if (data.stage === 'complete') return data;
    if (data.stage === 'error') throw new ApiError(data.error?.code ?? 'UNKNOWN_ERROR', data.error?.message ?? 'Generation failed.');

    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

export async function fetchHumanizedFloorplanSimpleHistory(): Promise<HumanizedFloorplanSimpleHistoryItem[]> {
  const res = await fetch(`${SIMPLE_BASE}/history`, { headers: await simpleAuthHeaders() });
  if (!res.ok) throw await readSimpleError(res, 'Failed to load history.');
  return ((await res.json()) as { items: HumanizedFloorplanSimpleHistoryItem[] }).items;
}

/** Full detail of one of the caller's generations (signed URLs for original, reference, result and downloads). */
export async function fetchHumanizedFloorplanSimpleGeneration(id: string): Promise<HumanizedFloorplanSimpleHistoryItem> {
  const res = await fetch(`${SIMPLE_BASE}/${id}`, { headers: await simpleAuthHeaders() });
  if (!res.ok) throw await readSimpleError(res, 'Failed to load the generation.');
  const data = (await res.json()) as HumanizedFloorplanSimpleJobStatusResponse;
  if (!data.item) throw new ApiError('UNKNOWN_ERROR', 'The generation is still in progress.');
  return data.item;
}

export async function deleteHumanizedFloorplanSimpleGeneration(id: string): Promise<void> {
  const res = await fetch(`${SIMPLE_BASE}/${id}`, { method: 'DELETE', headers: await simpleAuthHeaders() });
  if (!res.ok) throw await readSimpleError(res, 'Failed to delete the generation.');
}

// --- Imagem por Texto ---

export async function fetchTextToImageEngines(): Promise<T2IEngineInfo[]> {
  const res = await fetch('/api/text-to-image/engines');
  if (!res.ok) {
    throw new ApiError('PROVIDER_UNAVAILABLE', 'Could not load available engines.');
  }
  const data = (await res.json()) as { engines: T2IEngineInfo[] };
  return data.engines;
}

export async function submitTextToImageJob(
  settings: TextToImageSettings,
  referenceImage?: File | null
): Promise<T2ICreateJobResponse> {
  const form = new FormData();
  form.append('prompt', settings.prompt);
  form.append('engine', settings.engine);
  form.append('count', String(settings.count));
  form.append('aspectRatio', settings.aspectRatio);
  form.append('style', settings.style);
  form.append('projectType', settings.projectType);
  form.append('lighting', settings.lighting);
  form.append('environment', settings.environment);
  form.append('led', settings.led);
  form.append('creativity', settings.creativity);
  if (referenceImage) {
    form.append('referenceImage', referenceImage);
  }

  const res = await fetch('/api/text-to-image/generate', { method: 'POST', body: form, headers: await authHeaders() });
  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(
      data.error?.code ?? 'UNKNOWN_ERROR',
      data.error?.message ?? 'Failed to start generation.',
      data.error?.details
    );
  }
  return data as T2ICreateJobResponse;
}

export async function pollTextToImageJobUntilDone(
  jobId: string,
  onUpdate: (status: T2IJobStatusResponse) => void,
  signal: AbortSignal
): Promise<T2IJobStatusResponse> {
  const start = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal.aborted) {
      throw new ApiError('GENERATION_TIMEOUT', 'Generation was cancelled.');
    }
    if (Date.now() - start > CLIENT_TIMEOUT_MS) {
      throw new ApiError('GENERATION_TIMEOUT', 'The generation is taking longer than expected.');
    }

    const res = await fetch(`/api/text-to-image/generate/${jobId}`, { signal });
    if (!res.ok) {
      throw new ApiError('UNKNOWN_ERROR', 'Lost track of the generation job.');
    }
    const data = (await res.json()) as T2IJobStatusResponse;
    onUpdate(data);

    if (data.stage === 'complete') return data;
    if (data.stage === 'error') {
      throw new ApiError(data.error?.code ?? 'UNKNOWN_ERROR', data.error?.message ?? 'Generation failed.', data.error?.details);
    }

    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

// --- Gerador de Ideias ---

export async function fetchIdeaGeneratorEngines(mode: IdeaGenerationMode): Promise<IdeaEngineInfo[]> {
  const res = await fetch(`/api/idea-generator/engines?mode=${mode}`);
  if (!res.ok) {
    throw new ApiError('PROVIDER_UNAVAILABLE', 'Could not load available engines.');
  }
  const data = (await res.json()) as { engines: IdeaEngineInfo[] };
  return data.engines;
}

export async function submitIdeaGeneratorJob(
  settings: IdeaGeneratorSettings,
  referenceImage?: File | null
): Promise<IdeaCreateJobResponse> {
  const form = new FormData();
  form.append('environment', settings.environment);
  form.append('space', settings.space);
  form.append('goal', settings.goal);
  form.append('style', settings.style);
  form.append('engine', settings.engine);
  form.append('count', String(settings.count));
  form.append('preservation', settings.preservation);
  form.append('transformation', settings.transformation);
  form.append('lighting', settings.lighting);
  form.append('camera', settings.camera);
  form.append('atmosphere', settings.atmosphere);
  form.append('materials', settings.materials);
  form.append('surroundings', settings.surroundings);
  form.append('led', settings.led);
  form.append('creativity', settings.creativity);
  if (settings.details) {
    form.append('details', settings.details);
  }
  if (referenceImage) {
    form.append('referenceImage', referenceImage);
  }

  const res = await fetch('/api/idea-generator/generate', { method: 'POST', body: form, headers: await authHeaders() });
  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(
      data.error?.code ?? 'UNKNOWN_ERROR',
      data.error?.message ?? 'Failed to start generation.',
      data.error?.details
    );
  }
  return data as IdeaCreateJobResponse;
}

export async function pollIdeaGeneratorJobUntilDone(
  jobId: string,
  onUpdate: (status: IdeaJobStatusResponse) => void,
  signal: AbortSignal
): Promise<IdeaJobStatusResponse> {
  const start = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal.aborted) {
      throw new ApiError('GENERATION_TIMEOUT', 'Generation was cancelled.');
    }
    if (Date.now() - start > CLIENT_TIMEOUT_MS) {
      throw new ApiError('GENERATION_TIMEOUT', 'The generation is taking longer than expected.');
    }

    const res = await fetch(`/api/idea-generator/generate/${jobId}`, { signal });
    if (!res.ok) {
      throw new ApiError('UNKNOWN_ERROR', 'Lost track of the generation job.');
    }
    const data = (await res.json()) as IdeaJobStatusResponse;
    onUpdate(data);

    if (data.stage === 'complete') return data;
    if (data.stage === 'error') {
      throw new ApiError(data.error?.code ?? 'UNKNOWN_ERROR', data.error?.message ?? 'Generation failed.', data.error?.details);
    }

    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

// --- Editor de Vídeo ---
const EXPORT_CLIENT_TIMEOUT_MS = 600_000;

export async function uploadEditorMedia(file: File, kind: 'video' | 'image' | 'audio'): Promise<EditorMediaUploadResponse> {
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);

  const res = await fetch('/api/video-editor/media', { method: 'POST', body: form });
  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(
      data.error?.code ?? 'UNKNOWN_ERROR',
      data.error?.message ?? 'Failed to upload media.',
      data.error?.details
    );
  }
  return data as EditorMediaUploadResponse;
}

export async function submitEditorExportJob(project: EditorExportRequestProject): Promise<EditorExportCreateJobResponse> {
  const res = await fetch('/api/video-editor/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project }),
  });
  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(
      data.error?.code ?? 'UNKNOWN_ERROR',
      data.error?.message ?? 'Failed to start export.',
      data.error?.details
    );
  }
  return data as EditorExportCreateJobResponse;
}

export async function pollEditorExportJobUntilDone(
  jobId: string,
  onUpdate: (status: EditorExportJobStatusResponse) => void,
  signal: AbortSignal
): Promise<EditorExportJobStatusResponse> {
  const start = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal.aborted) {
      throw new ApiError('GENERATION_TIMEOUT', 'Export was cancelled.');
    }
    if (Date.now() - start > EXPORT_CLIENT_TIMEOUT_MS) {
      throw new ApiError('GENERATION_TIMEOUT', 'The export is taking longer than expected.');
    }

    const res = await fetch(`/api/video-editor/export/${jobId}`, { signal });
    if (!res.ok) {
      throw new ApiError('UNKNOWN_ERROR', 'Lost track of the export job.');
    }
    const data = (await res.json()) as EditorExportJobStatusResponse;
    onUpdate(data);

    if (data.stage === 'complete') return data;
    if (data.stage === 'error') {
      throw new ApiError(data.error?.code ?? 'UNKNOWN_ERROR', data.error?.message ?? 'Export failed.', data.error?.details);
    }

    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

// --- Billing (Stripe Checkout) ---

export type CheckoutErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'PRICE_NOT_CONFIGURED' | 'BILLING_NOT_CONFIGURED' | 'UNKNOWN_ERROR';

export class CheckoutError extends Error {
  code: CheckoutErrorCode;
  constructor(code: CheckoutErrorCode, message: string) {
    super(message);
    this.name = 'CheckoutError';
    this.code = code;
  }
}

/** Starts a hosted Stripe Checkout session and returns its redirect URL. Caller does `window.location.href = url`. */
export async function startCheckout(
  organizationId: string,
  plan: PlanId,
  interval: 'monthly' | 'yearly',
  accessToken: string
): Promise<string> {
  const res = await fetch('/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ organizationId, plan, interval }),
  });
  const data = await res.json();
  if (!res.ok) {
    const code = (data?.error?.code as CheckoutErrorCode) ?? 'UNKNOWN_ERROR';
    throw new CheckoutError(code, data?.error?.message ?? 'Could not start checkout.');
  }
  return (data as { url: string }).url;
}

// --- Vídeo IA ---

export async function fetchVideoPricing(): Promise<VideoPricingResponse> {
  const res = await fetch('/api/video-generator/pricing');
  if (!res.ok) {
    throw new ApiError('PROVIDER_UNAVAILABLE', 'Could not load video pricing.');
  }
  return (await res.json()) as VideoPricingResponse;
}

export async function submitVideoGeneratorJob(
  settings: VideoGeneratorSettings,
  sourceImage?: File | null
): Promise<VideoCreateJobResponse> {
  const form = new FormData();
  form.append('prompt', settings.prompt);
  form.append('durationSeconds', String(settings.durationSeconds));
  if (sourceImage) {
    form.append('sourceImage', sourceImage);
  }

  const res = await fetch('/api/video-generator/generate', { method: 'POST', body: form, headers: await authHeaders() });
  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(
      data.error?.code ?? 'UNKNOWN_ERROR',
      data.error?.message ?? 'Failed to start generation.',
      data.error?.details
    );
  }
  return data as VideoCreateJobResponse;
}

export async function pollVideoGeneratorJobUntilDone(
  jobId: string,
  onUpdate: (status: VideoJobStatusResponse) => void,
  signal: AbortSignal
): Promise<VideoJobStatusResponse> {
  const start = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal.aborted) {
      throw new ApiError('GENERATION_TIMEOUT', 'Generation was cancelled.');
    }
    if (Date.now() - start > VIDEO_CLIENT_TIMEOUT_MS) {
      throw new ApiError('GENERATION_TIMEOUT', 'The video is taking longer than expected.');
    }

    const res = await fetch(`/api/video-generator/generate/${jobId}`, { signal });
    if (!res.ok) {
      throw new ApiError('UNKNOWN_ERROR', 'Lost track of the generation job.');
    }
    const data = (await res.json()) as VideoJobStatusResponse;
    onUpdate(data);

    if (data.stage === 'complete') return data;
    if (data.stage === 'error') {
      throw new ApiError(data.error?.code ?? 'UNKNOWN_ERROR', data.error?.message ?? 'Generation failed.', data.error?.details);
    }

    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

// --- Arquiteto Estagiário (chat assistant) ------------------------------------

export async function fetchArchitectChatConfig(): Promise<ArchitectChatConfig> {
  const res = await fetch('/api/architect-chat/config');
  if (!res.ok) throw new ApiError('PROVIDER_UNAVAILABLE', 'Could not load the assistant configuration.');
  return (await res.json()) as ArchitectChatConfig;
}

export async function listArchitectConversations(): Promise<ArchitectChatConversationSummary[]> {
  const res = await fetch('/api/architect-chat/conversations', { headers: await authHeaders() });
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error?.code ?? 'UNKNOWN_ERROR', data.error?.message ?? 'Could not load conversations.');
  return (data as { conversations: ArchitectChatConversationSummary[] }).conversations;
}

export async function getArchitectConversation(id: string): Promise<ArchitectChatConversationDetail> {
  const res = await fetch(`/api/architect-chat/conversations/${id}`, { headers: await authHeaders() });
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error?.code ?? 'UNKNOWN_ERROR', data.error?.message ?? 'Could not load the conversation.');
  return data as ArchitectChatConversationDetail;
}

export async function deleteArchitectConversation(id: string): Promise<void> {
  const res = await fetch(`/api/architect-chat/conversations/${id}`, { method: 'DELETE', headers: await authHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error?.code ?? 'UNKNOWN_ERROR', data.error?.message ?? 'Could not delete the conversation.');
  }
}

/**
 * Sends one chat message (text and/or attachments) and streams the assistant's
 * reply back as Server-Sent Events. `conversationId` is the literal "new" to
 * start a fresh conversation. `onEvent` fires for every event in order
 * (start -> delta* -> done, or start -> error); the promise resolves once the
 * stream ends normally and rejects only on a connection-level failure (a
 * business error still arrives as an 'error' event, not a rejection).
 */
export async function sendArchitectChatMessage(
  conversationId: string,
  text: string,
  attachments: File[],
  onEvent: (event: ArchitectChatStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const form = new FormData();
  if (text) form.append('text', text);
  for (const file of attachments) form.append('attachments', file);

  const res = await fetch(`/api/architect-chat/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: form,
    headers: await authHeaders(),
    signal,
  });

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error?.code ?? 'UNKNOWN_ERROR', data.error?.message ?? 'Could not send the message.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const line = raw.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const payload = line.slice('data: '.length);
      if (payload === '[DONE]') continue;
      try {
        onEvent(JSON.parse(payload) as ArchitectChatStreamEvent);
      } catch {
        // A malformed chunk is skipped rather than crashing the whole stream.
      }
    }
  }
}
