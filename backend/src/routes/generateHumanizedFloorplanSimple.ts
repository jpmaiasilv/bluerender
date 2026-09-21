import { Request, Response, Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { Jimp } from 'jimp';
import { AppError } from '../lib/errors';
import { detectImageMimeType } from '../lib/fileSignature';
import { requireAuth, AuthenticatedRequest } from '../middleware/requireAuth';
import { generateHumanizedFloorplanImage } from '../providers/openaiBlockImage';
import { buildHumanizedFloorplanPrompt } from '../lib/openaiImage/humanizedFloorplanPrompt';
import { validateGeneratedFloorplanPng } from '../lib/openaiImage/floorplanImageValidation';
import { prepareFloorplanCanvas } from '../lib/openaiImage/floorplanCanvas';
import { serverLogger } from '../lib/logger';
import { logJobCreation } from '../services/jobCreationLog';
import {
  DEFAULT_HUMANIZED_FLOORPLAN_LIGHTING,
  DEFAULT_HUMANIZED_FLOORPLAN_SURROUNDINGS,
  HUMANIZED_FLOORPLAN_FURNITURE_LEVELS,
  HUMANIZED_FLOORPLAN_LIGHTING_OPTIONS,
  HUMANIZED_FLOORPLAN_OUTPUT_FORMATS,
  HUMANIZED_FLOORPLAN_OUTPUT_FORMAT_SIZES,
  HUMANIZED_FLOORPLAN_SIMPLE_STYLES,
  HUMANIZED_FLOORPLAN_SURROUNDINGS_KINDS,
  HUMANIZED_FLOORPLAN_SURROUNDINGS_OPTIONS,
  HUMANIZED_FLOORPLAN_TEXT_MODES,
  MAX_HUMANIZED_FLOORPLAN_CUSTOM_SURROUNDINGS_CHARS,
  MAX_HUMANIZED_FLOORPLAN_CUSTOM_TEXT_CHARS,
  HumanizedFloorplanFurnitureLevel,
  HumanizedFloorplanLighting,
  HumanizedFloorplanOutputFormat,
  HumanizedFloorplanSimpleStyle,
  HumanizedFloorplanSurroundings,
  HumanizedFloorplanSurroundingsKind,
  HumanizedFloorplanTextMode,
  isOneOf,
} from '../config/humanizedFloorplanSimpleStyles';
import {
  DEFAULT_HUMANIZED_FLOORPLAN_MODE,
  HUMANIZED_FLOORPLAN_GENERATION_MODES,
  HUMANIZED_FLOORPLAN_MODE_COSTS,
  HumanizedFloorplanGenerationMode,
} from '../config/humanizedFloorplanEngine';
import { isAstraFlagEnabled } from '../config/humanizedFloorplanAstra';
import { runAstraPipeline } from '../services/humanizedFloorplanAstraPipeline';
import { OPENAI_ASTRA_MODEL, OPENAI_BLOCK_IMAGE_MODEL } from '../config/openaiModels';
import { ActiveReservation, captureCredits, refundCredits, reserveCredits } from '../services/creditWallet';
import { recordGeneration } from '../services/generationLog';
import { estimateOpenAiImageCostUsd } from '../services/openaiImageCost';
import { DuplicateGenerationError, GenerationRecord, GenerationStore, getGenerationStore } from '../services/humanizedFloorplanStore';
import { HUMANIZED_ASTRA_TOOL, HUMANIZED_TOOL, markGenerationDone, markGenerationLive } from '../services/humanizedFloorplanReconciler';
import { getWalletBackend } from '../services/creditWallet';
import { HumanizedFileStorage, StorableMime, contentTypeForPath, getFileStorage, isSafePathSegment, verifyFileToken } from '../storage/humanizedFloorplanFiles';
import {
  HumanizedFloorplanSimpleConfigResponse,
  HumanizedFloorplanSimpleCreateJobResponse,
  HumanizedFloorplanSimpleHistoryItem,
  HumanizedFloorplanSimpleJobStage,
  HumanizedFloorplanSimpleJobStatusResponse,
} from '../types/humanizedFloorplan';

/**
 * Planta Humanizada — primary flow. Auth required (Supabase bearer token
 * verified by requireAuth). Lifecycle of one generation:
 *
 *   1. authenticate, validate inputs and any reused files (ownership)
 *   2. create the generation record (unique per user + idempotency key)
 *   3. RESERVE the credits atomically in the database
 *   4. store the input files in the private bucket
 *   5. one OpenAI image-to-image call
 *   6. validate the image, store PNG + JPG, verify the result is readable
 *   7. CAPTURE the credits, mark the generation completed
 *   *  any failure at any step: mark failed and REFUND the reservation
 *
 * Does not import OpenCV, Vision, Gemini, FLUX, or the advanced route.
 */

export const MAX_FILE_SIZE = 15 * 1024 * 1024;
const HISTORY_DEFAULT_LIMIT = 30;
const HISTORY_MAX_LIMIT = 100;
const ROUTE_PATH = '/generate-humanized-floorplan-simple';
const UUID_PATTERN = /^[0-9a-fA-F-]{36}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const toolFor = (mode: HumanizedFloorplanGenerationMode): string => (mode === 'astra' ? HUMANIZED_ASTRA_TOOL : HUMANIZED_TOOL);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE, files: 2 } });
const uploadFields = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'styleReference', maxCount: 1 },
]);

export const generateHumanizedFloorplanSimpleRouter = Router();

// --- In-memory bookkeeping (stage for polling + a fast idempotency guard; the
// durable truth — record, ledger, idempotency uniqueness — lives in the database) ---

interface LiveJob {
  id: string;
  userId: string;
  stage: HumanizedFloorplanSimpleJobStage;
  startedAt: number;
}

const liveJobs = new Map<string, LiveJob>();
/** `${userId}:${idempotencyKey}` -> generation id. Claimed synchronously so simultaneous identical requests never both proceed inside one process. */
const idempotencyClaims = new Map<string, { id: string; mode: HumanizedFloorplanGenerationMode }>();

// --- Helpers -----------------------------------------------------------------

function sendError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    // details are dropped on purpose: nothing internal/provider-raw goes to the browser.
    res.status(err.httpStatus).json({ error: { code: err.code, message: err.message } });
    return;
  }
  serverLogger.error('Unexpected error handling humanized floor plan request', err instanceof Error ? err.message : String(err));
  res.status(500).json({ error: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred.' } });
}

function infrastructureUnavailable(err: unknown): AppError {
  serverLogger.error('Humanized floor plan infrastructure unavailable', err instanceof Error ? err.message : String(err));
  return new AppError('PROVIDER_UNAVAILABLE', 'Storage is temporarily unavailable. No credits were used.', undefined, 503);
}

function sanitizeFileName(name: string | undefined): string | null {
  if (!name) return null;
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[^\w.\- ]+/g, '_').trim().slice(0, 120);
  return cleaned || null;
}

function runUpload(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    uploadFields(req, res, (err: unknown) => {
      if (!err) return resolve();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return reject(new AppError('FILE_TOO_LARGE', 'The file is larger than the allowed size.', undefined, 413));
      }
      reject(new AppError('IMAGE_UPLOAD_FAILED', 'The file upload failed.', undefined, 400));
    });
  });
}

interface PickedImage {
  buffer: Buffer;
  mime: StorableMime;
  name: string | null;
}

/** The type comes from the file's own bytes (magic number), never from the client-declared type or extension. */
function pickImage(files: Express.Multer.File[] | undefined, label: string): PickedImage | null {
  const file = files?.[0];
  if (!file) return null;
  const mime = detectImageMimeType(file.buffer);
  if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp') {
    throw new AppError('IMAGE_UPLOAD_FAILED', `Unsupported ${label} image format. Use PNG, JPG, JPEG or WEBP.`, undefined, 400);
  }
  return { buffer: file.buffer, mime, name: sanitizeFileName(file.originalname) };
}

function parseMode(value: unknown): HumanizedFloorplanGenerationMode {
  if (value === undefined || value === null || value === '') return DEFAULT_HUMANIZED_FLOORPLAN_MODE;
  if (!isOneOf(HUMANIZED_FLOORPLAN_GENERATION_MODES, value)) throw new AppError('VALIDATION_ERROR', 'Invalid generation mode.', undefined, 400);
  return value;
}

/**
 * The Astra mode is available only when its flag is on, the OpenAI key is
 * configured and the persistent infrastructure (wallet, generations, private
 * storage) resolved. Those resolutions are cached promises: this never makes a
 * paid call and is cheap to ask on every page load.
 */
export async function isAstraAvailable(): Promise<boolean> {
  if (!isAstraFlagEnabled() || !process.env.OPENAI_API_KEY) return false;
  try {
    await getWalletBackend();
    await getGenerationStore();
    await getFileStorage();
    return true;
  } catch {
    return false;
  }
}

interface ParsedSettings {
  style: HumanizedFloorplanSimpleStyle;
  lighting: HumanizedFloorplanLighting;
  surroundings: HumanizedFloorplanSurroundings;
  surroundingsKind: HumanizedFloorplanSurroundingsKind | null;
  customSurroundings: string | null;
  textMode: HumanizedFloorplanTextMode;
  furnitureLevel: HumanizedFloorplanFurnitureLevel;
  outputFormat: HumanizedFloorplanOutputFormat;
  customInstructions: string | null;
}

function optionalText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

/** Validates every client-supplied setting against the server's own allowed lists; anything absent falls back to the documented default. Cost, user, status are never read from the body. */
export function parseSettings(body: Record<string, unknown>): ParsedSettings {
  const style = body.style;
  if (!isOneOf(HUMANIZED_FLOORPLAN_SIMPLE_STYLES, style)) throw new AppError('VALIDATION_ERROR', 'Invalid style.', undefined, 400);

  const pick = <T extends string>(list: readonly T[], value: unknown, fallback: T, field: string): T => {
    if (value === undefined || value === null || value === '') return fallback;
    if (!isOneOf(list, value)) throw new AppError('VALIDATION_ERROR', `Invalid ${field}.`, undefined, 400);
    return value;
  };

  const surroundings = pick(HUMANIZED_FLOORPLAN_SURROUNDINGS_OPTIONS, body.surroundings, DEFAULT_HUMANIZED_FLOORPLAN_SURROUNDINGS, 'surroundings');
  let surroundingsKind: HumanizedFloorplanSurroundingsKind | null = null;
  let customSurroundings: string | null = null;
  if (surroundings === 'with') {
    surroundingsKind = pick(HUMANIZED_FLOORPLAN_SURROUNDINGS_KINDS, body.surroundingsKind, 'lawn', 'surroundingsKind');
    if (surroundingsKind === 'custom') customSurroundings = optionalText(body.customSurroundings, MAX_HUMANIZED_FLOORPLAN_CUSTOM_SURROUNDINGS_CHARS);
  }

  return {
    style,
    lighting: pick(HUMANIZED_FLOORPLAN_LIGHTING_OPTIONS, body.lighting, DEFAULT_HUMANIZED_FLOORPLAN_LIGHTING, 'lighting'),
    surroundings,
    surroundingsKind,
    customSurroundings,
    textMode: pick(HUMANIZED_FLOORPLAN_TEXT_MODES, body.textMode, 'auto', 'textMode'),
    furnitureLevel: pick(HUMANIZED_FLOORPLAN_FURNITURE_LEVELS, body.furnitureLevel, 'auto', 'furnitureLevel'),
    outputFormat: pick(HUMANIZED_FLOORPLAN_OUTPUT_FORMATS, body.outputFormat, 'original', 'outputFormat'),
    customInstructions: optionalText(body.customInstructions, MAX_HUMANIZED_FLOORPLAN_CUSTOM_TEXT_CHARS),
  };
}

function downloadName(record: GenerationRecord, ext: 'png' | 'jpg'): string {
  return `planta-humanizada-${record.createdAt.slice(0, 10)}-${record.id.slice(0, 8)}.${ext}`;
}

/**
 * Everything the browser may know about a generation — no prompt, provider
 * payload, cost, usage or storage path. Files are exposed only as short-lived
 * signed URLs; `full: false` (history list) signs just the thumbnail.
 */
export async function toHistoryItem(r: GenerationRecord, storage: HumanizedFileStorage, full: boolean): Promise<HumanizedFloorplanSimpleHistoryItem> {
  const completed = r.status === 'completed';
  const sign = (p: string | null, name?: string) => (p ? storage.signedUrl(p, name).catch(() => null) : Promise.resolve(null));
  const [thumbnailUrl, originalUrl, referenceUrl, downloadPngUrl, downloadJpgUrl] = await Promise.all([
    completed ? sign(r.resultPath) : null,
    full ? sign(r.originalPath) : null,
    full ? sign(r.referencePath) : null,
    full && completed ? sign(r.resultPath, downloadName(r, 'png')) : null,
    full && completed ? sign(r.resultJpgPath, downloadName(r, 'jpg')) : null,
  ]);
  return {
    id: r.id,
    status: r.status,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    style: r.style,
    lighting: r.lighting,
    surroundings: r.surroundings,
    surroundingsKind: r.surroundingsKind,
    customSurroundings: r.customSurroundings,
    textMode: r.textMode,
    furnitureLevel: r.furnitureLevel,
    outputFormat: r.outputFormat,
    customInstructions: r.customInstructions,
    creditsUsed: r.creditsCaptured ?? 0,
    generationMode: r.generationMode === 'astra' ? 'astra' : 'standard',
    hasReference: r.hasReference,
    originalFileName: r.originalFileName,
    errorCode: r.errorCode,
    thumbnailUrl,
    resultUrl: thumbnailUrl,
    originalUrl,
    referenceUrl,
    downloadPngUrl,
    downloadJpgUrl,
  };
}

function userIdOf(req: Request): string {
  const id = (req as AuthenticatedRequest).user?.id;
  if (!id) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.', undefined, 401);
  return id;
}

async function infra(): Promise<{ store: GenerationStore; storage: HumanizedFileStorage }> {
  try {
    return { store: await getGenerationStore(), storage: await getFileStorage() };
  } catch (err) {
    throw infrastructureUnavailable(err);
  }
}

// --- Routes ------------------------------------------------------------------

/** Single source of truth for the cost: the same shared backend constant the reservation itself uses. */
generateHumanizedFloorplanSimpleRouter.get(`${ROUTE_PATH}/config`, async (_req: Request, res: Response) => {
  const payload: HumanizedFloorplanSimpleConfigResponse = {
    costCredits: HUMANIZED_FLOORPLAN_MODE_COSTS.standard,
    maxFileSizeBytes: MAX_FILE_SIZE,
    humanizedFloorplan: {
      modes: {
        standard: { cost: HUMANIZED_FLOORPLAN_MODE_COSTS.standard, available: true },
        astra: { cost: HUMANIZED_FLOORPLAN_MODE_COSTS.astra, available: await isAstraAvailable() },
      },
    },
  };
  res.json(payload);
});

generateHumanizedFloorplanSimpleRouter.get(`${ROUTE_PATH}/history`, requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = userIdOf(req);
    const requested = Number(req.query.limit);
    const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, HISTORY_MAX_LIMIT) : HISTORY_DEFAULT_LIMIT;
    const { store, storage } = await infra();
    const records = await store.list(userId, limit);
    res.json({ items: await Promise.all(records.map((r) => toHistoryItem(r, storage, false))) });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Local-disk signed links — exists ONLY while the explicit dev fallback is
 * active. With Supabase Storage the browser gets Supabase's own signed URLs
 * and this route answers 404 (nothing is served from the server's disk).
 */
generateHumanizedFloorplanSimpleRouter.get(`${ROUTE_PATH}/file`, async (req: Request, res: Response) => {
  try {
    const storage = await getFileStorage().catch(() => null);
    if (!storage || storage.backend !== 'local') {
      res.status(404).json({ error: { code: 'RESULT_IMAGE_UNAVAILABLE', message: 'Not found.' } });
      return;
    }
    const claims = verifyFileToken(typeof req.query.token === 'string' ? req.query.token : '');
    if (!claims) {
      res.status(403).json({ error: { code: 'UNAUTHENTICATED', message: 'This link is invalid or has expired.' } });
      return;
    }
    const buffer = await storage.read(claims.path);
    if (!buffer) {
      res.status(404).json({ error: { code: 'RESULT_IMAGE_UNAVAILABLE', message: 'The file is no longer available.' } });
      return;
    }
    res.setHeader('Content-Type', contentTypeForPath(claims.path));
    res.setHeader('Cache-Control', 'private, max-age=300');
    if (claims.name) res.setHeader('Content-Disposition', `attachment; filename="${claims.name.replace(/[^\w.\-]+/g, '_')}"`);
    res.send(buffer);
  } catch (err) {
    sendError(res, err);
  }
});

/** Best-effort: a JPG copy for the "Baixar JPG" button. A failure here never fails the generation. */
async function makeJpg(png: Buffer): Promise<Buffer | null> {
  try {
    const image = await Jimp.read(png);
    return Buffer.from(await image.getBuffer('image/jpeg', { quality: 92 }));
  } catch (err) {
    serverLogger.error('Could not create the JPG copy of a result', err instanceof Error ? err.message : String(err));
    return null;
  }
}

generateHumanizedFloorplanSimpleRouter.post(ROUTE_PATH, requireAuth, async (req: Request, res: Response) => {
  let userId: string;
  try {
    userId = userIdOf(req);
    await runUpload(req, res);
  } catch (err) {
    sendError(res, err);
    return;
  }

  let claimKey: string | null = null;
  let generationId = '';
  let store: GenerationStore | null = null;
  let recordInserted = false;
  let reservation: ActiveReservation | null = null;
  let handedOff = false;
  try {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const idempotencyKey = typeof body.idempotencyKey === 'string' && IDEMPOTENCY_KEY_PATTERN.test(body.idempotencyKey) ? body.idempotencyKey : null;
    if (!idempotencyKey) throw new AppError('VALIDATION_ERROR', 'A valid idempotency key is required.', undefined, 400);

    const settings = parseSettings(body);
    const image = pickImage(files?.image, 'floor plan');
    const reference = pickImage(files?.styleReference, 'style reference');
    const sourceGenerationId = typeof body.sourceGenerationId === 'string' && UUID_PATTERN.test(body.sourceGenerationId) ? body.sourceGenerationId : null;
    if (!image && !sourceGenerationId) throw new AppError('IMAGE_UPLOAD_FAILED', 'No floor plan image file was received.', undefined, 400);
    const reuseSourceReference = body.reuseSourceReference === '1' || body.reuseSourceReference === 'true';

    // The mode picks the price on the SERVER. No cost, model or status is ever read from the request.
    const generationMode = parseMode(body.generationMode);
    if (generationMode === 'astra' && !(await isAstraAvailable())) {
      throw new AppError('VALIDATION_ERROR', 'The Astra generation mode is not available.', undefined, 400);
    }
    const cost = HUMANIZED_FLOORPLAN_MODE_COSTS[generationMode];

    // Fast in-process guard: the second of two simultaneous identical requests gets the first one's generation.
    claimKey = `${userId}:${idempotencyKey}`;
    const claimed = idempotencyClaims.get(claimKey);
    if (claimed) {
      if (claimed.mode !== generationMode) throw new AppError('VALIDATION_ERROR', 'This request key was already used with a different generation mode.', undefined, 409);
      logJobCreation({ route: ROUTE_PATH, jobId: claimed.id, idempotencyKey, reusedExistingJob: true, ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });
      res.status(202).json({ jobId: claimed.id, startedAt: liveJobs.get(claimed.id)?.startedAt ?? Date.now() } satisfies HumanizedFloorplanSimpleCreateJobResponse);
      claimKey = null;
      return;
    }
    generationId = crypto.randomUUID();
    idempotencyClaims.set(claimKey, { id: generationId, mode: generationMode });
    markGenerationLive(generationId);

    const infrastructure = await infra();
    store = infrastructure.store;
    const storage = infrastructure.storage;

    // Persistent idempotency (survives restarts and multiple instances): the same key already produced a generation -> hand that one back.
    const previous = await store.findByIdempotencyKey(userId, idempotencyKey);
    if (previous) {
      if (previous.generationMode !== generationMode) throw new AppError('VALIDATION_ERROR', 'This request key was already used with a different generation mode.', undefined, 409);
      idempotencyClaims.set(claimKey, { id: previous.id, mode: previous.generationMode });
      markGenerationDone(generationId);
      res.status(202).json({ jobId: previous.id, startedAt: Date.parse(previous.createdAt) } satisfies HumanizedFloorplanSimpleCreateJobResponse);
      claimKey = null;
      generationId = '';
      return;
    }

    // Reuse of files from an earlier generation: ONLY the caller's own (the store query is scoped to userId).
    let source: GenerationRecord | null = null;
    if (!image) {
      source = await store.get(userId, sourceGenerationId!);
      if (!source?.originalPath || !source.originalPath.startsWith(`${userId}/`)) {
        throw new AppError('IMAGE_UPLOAD_FAILED', 'The original floor plan of that generation is no longer available.', undefined, 404);
      }
    }

    const startedAt = Date.now();
    const record: GenerationRecord = {
      id: generationId,
      userId,
      idempotencyKey,
      status: 'processing',
      originalFileName: image ? image.name : (source?.originalFileName ?? null),
      referenceFileName: reference?.name ?? null,
      hasReference: false,
      sourceGenerationId,
      ...settings,
      creditsReserved: 0,
      creditsCaptured: 0,
      creditsRefunded: 0,
      reservationId: null,
      captureTransactionId: null,
      refundTransactionId: null,
      provider: 'openai-image',
      model: OPENAI_BLOCK_IMAGE_MODEL,
      quality: null,
      size: null,
      requestId: null,
      usage: null,
      costUsd: null,
      errorCode: null,
      errorMessage: null,
      originalPath: null,
      referencePath: null,
      resultPath: null,
      resultJpgPath: null,
      createdAt: new Date(startedAt).toISOString(),
      completedAt: null,
      deletedAt: null,
      generationMode,
      analysisModel: generationMode === 'astra' ? OPENAI_ASTRA_MODEL : null,
      analysisStatus: null,
      validationStatus: null,
      fidelityScore: null,
      attemptsCount: 1,
      autoCorrectionApplied: false,
      violationsSummary: null,
      pipelineStage: null,
    };
    try {
      await store.insert(record);
      recordInserted = true;
    } catch (err) {
      if (err instanceof DuplicateGenerationError) {
        const existing = await store.findByIdempotencyKey(userId, idempotencyKey);
        if (existing) {
          idempotencyClaims.set(claimKey, { id: existing.id, mode: existing.generationMode });
          markGenerationDone(generationId);
          res.status(202).json({ jobId: existing.id, startedAt: Date.parse(existing.createdAt) } satisfies HumanizedFloorplanSimpleCreateJobResponse);
          claimKey = null;
          generationId = '';
          return;
        }
      }
      throw infrastructureUnavailable(err);
    }
    const live: LiveJob = { id: generationId, userId, stage: 'uploading', startedAt };
    liveJobs.set(generationId, live);

    // Atomic reservation in the database. Refused (402) when the balance is short; the just-created row is discarded then.
    try {
      reservation = await reserveCredits({ userId, amount: cost, tool: toolFor(generationMode), generationId, idempotencyKey: `${toolFor(generationMode)}:${idempotencyKey}` });
    } catch (err) {
      await store.discardUnreserved(userId, generationId).catch(() => undefined);
      recordInserted = false;
      throw err;
    }
    await store.update(userId, generationId, { reservationId: reservation.id, creditsReserved: cost });

    // Input files -> private bucket.
    let originalBuffer: Buffer;
    let originalMime: StorableMime;
    let referenceBuffer: Buffer | null = reference?.buffer ?? null;
    let referenceMime: StorableMime | undefined = reference?.mime;
    let referenceName: string | null = reference?.name ?? null;
    try {
      if (image) {
        originalBuffer = image.buffer;
        originalMime = image.mime;
      } else {
        const stored = await storage.read(source!.originalPath!);
        const detected = stored ? detectImageMimeType(stored) : null;
        if (!stored || (detected !== 'image/png' && detected !== 'image/jpeg' && detected !== 'image/webp')) {
          throw new AppError('IMAGE_UPLOAD_FAILED', 'The original floor plan of that generation is no longer available.', undefined, 404);
        }
        originalBuffer = stored;
        originalMime = detected;
        if (!referenceBuffer && reuseSourceReference && source!.referencePath && source!.referencePath.startsWith(`${userId}/`)) {
          referenceBuffer = await storage.read(source!.referencePath);
          const detectedRef = referenceBuffer ? detectImageMimeType(referenceBuffer) : null;
          referenceMime = detectedRef === 'image/jpeg' || detectedRef === 'image/webp' ? detectedRef : 'image/png';
          referenceName = source!.referenceFileName;
        }
      }
      const originalPath = await storage.save(userId, generationId, 'original', originalBuffer, originalMime);
      const referencePath = referenceBuffer ? await storage.save(userId, generationId, 'style-reference', referenceBuffer, referenceMime ?? 'image/png') : null;
      record.originalPath = originalPath;
      record.referencePath = referencePath;
      record.hasReference = Boolean(referenceBuffer);
      record.referenceFileName = referenceBuffer ? referenceName : null;
      await store.update(userId, generationId, { originalPath, referencePath, hasReference: record.hasReference, referenceFileName: record.referenceFileName });
    } catch (err) {
      throw err instanceof AppError ? err : infrastructureUnavailable(err);
    }

    logJobCreation({ route: ROUTE_PATH, jobId: generationId, idempotencyKey, reusedExistingJob: false, ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });
    handedOff = true;
    res.status(202).json({ jobId: generationId, startedAt } satisfies HumanizedFloorplanSimpleCreateJobResponse);

    const jobInput: JobInput = { originalBuffer, originalMime, referenceBuffer, referenceMime };
    void (generationMode === 'astra' ? runAstraJob(store, storage, record, live, reservation, jobInput) : runJob(store, storage, record, live, reservation, jobInput));
  } catch (err) {
    if (!handedOff) {
      // Failed before the job started: give any reservation back, close the record, release the idempotency claim.
      if (claimKey) idempotencyClaims.delete(claimKey);
      if (generationId) {
        liveJobs.delete(generationId);
        markGenerationDone(generationId);
      }
      if (reservation && store) {
        const failure = sanitizedFailure(err);
        await failGeneration(store, userId, generationId, reservation, failure);
      } else if (recordInserted && store) {
        await store.discardUnreserved(userId, generationId).catch(() => undefined);
      }
    }
    if (!(err instanceof AppError)) serverLogger.error('Humanized floor plan generation could not start', err instanceof Error ? err.message : String(err));
    sendError(res, err);
  }
});

/** Read-only and ownership-checked. Polling only ever reads state — it cannot start a generation or touch credits. */
generateHumanizedFloorplanSimpleRouter.get(`${ROUTE_PATH}/:jobId`, requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = userIdOf(req);
    const id = req.params.jobId;
    if (!UUID_PATTERN.test(id)) throw new AppError('VALIDATION_ERROR', 'Invalid generation id.', undefined, 400);
    const { store, storage } = await infra();
    const record = await store.get(userId, id);
    if (!record) {
      res.status(404).json({ error: { code: 'UNKNOWN_ERROR', message: 'Generation not found.' } });
      return;
    }
    const live = liveJobs.get(id);
    const stage: HumanizedFloorplanSimpleJobStage = record.status === 'completed' ? 'complete' : record.status === 'failed' ? 'error' : (live?.stage ?? (record.pipelineStage as HumanizedFloorplanSimpleJobStage | null) ?? 'generating');
    const terminal = record.status !== 'processing';
    const item = terminal ? await toHistoryItem(record, storage, true) : undefined;
    const payload: HumanizedFloorplanSimpleJobStatusResponse = {
      jobId: id,
      stage,
      mode: record.generationMode === 'astra' ? 'astra' : 'standard',
      startedAt: Date.parse(record.createdAt),
      ...(item ? { item } : {}),
      ...(record.status === 'completed' && item ? { result: item } : {}),
      ...(record.status === 'failed' ? { error: { code: (record.errorCode as 'UNKNOWN_ERROR') ?? 'UNKNOWN_ERROR', message: record.errorMessage ?? 'The generation was not completed.' } } : {}),
    };
    res.json(payload);
  } catch (err) {
    sendError(res, err);
  }
});

generateHumanizedFloorplanSimpleRouter.delete(`${ROUTE_PATH}/:jobId`, requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = userIdOf(req);
    const id = req.params.jobId;
    if (!UUID_PATTERN.test(id) || !isSafePathSegment(id)) throw new AppError('VALIDATION_ERROR', 'Invalid generation id.', undefined, 400);
    const { store, storage } = await infra();
    const record = await store.get(userId, id);
    if (!record) {
      res.status(404).json({ error: { code: 'UNKNOWN_ERROR', message: 'Generation not found.' } });
      return;
    }
    if (record.status === 'processing') throw new AppError('VALIDATION_ERROR', 'This generation is still in progress.', undefined, 409);
    // Database first (so the history is consistent immediately), then the files — whose paths are derived from ids, so a failure here leaves nothing unreachable to clean up.
    await store.softDelete(userId, id);
    try {
      await storage.removeGeneration(userId, id);
    } catch (err) {
      serverLogger.error(`Generation ${id} was deleted from the history but its files could not be removed yet`, err instanceof Error ? err.message : String(err));
    }
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

// --- Job ---------------------------------------------------------------------

interface JobInput {
  originalBuffer: Buffer;
  originalMime: StorableMime;
  referenceBuffer: Buffer | null;
  referenceMime?: StorableMime;
}

const SAFE_ERROR_MESSAGES: Record<string, string> = {
  PROVIDER_UNAVAILABLE: 'The image service is unavailable right now.',
  GENERATION_TIMEOUT: 'The generation took too long.',
  GENERATION_FAILED: 'The generation could not be completed.',
  VALIDATION_ERROR: 'The request was not accepted by the image service.',
  INVALID_API_KEY: 'The image service is not available right now.',
  RESULT_IMAGE_UNAVAILABLE: 'The generated image could not be saved.',
  IMAGE_UPLOAD_FAILED: 'The floor plan file could not be used.',
  INSUFFICIENT_CREDITS: 'Not enough credits.',
};

function sanitizedFailure(err: unknown): { code: string; message: string } {
  const code = err instanceof AppError && SAFE_ERROR_MESSAGES[err.code] ? err.code : 'UNKNOWN_ERROR';
  return { code, message: SAFE_ERROR_MESSAGES[code] ?? 'An unexpected error occurred during generation.' };
}

/** Closes a generation as failed and returns its reservation. The wallet refund comes FIRST so no later database problem can leave the user charged; anything unrecorded is finished by reconciliation. */
async function failGeneration(store: GenerationStore, userId: string, generationId: string, reservation: ActiveReservation, failure: { code: string; message: string }): Promise<void> {
  const refunded = await refundCredits(reservation, failure.code.toLowerCase());
  try {
    await store.update(userId, generationId, {
      status: 'failed',
      creditsCaptured: 0,
      creditsRefunded: refunded?.refunded ?? 0,
      refundTransactionId: refunded?.refundId ?? null,
      errorCode: failure.code,
      errorMessage: failure.message,
      completedAt: new Date().toISOString(),
    });
  } catch (storeErr) {
    serverLogger.error(`Could not record the failure of generation ${generationId}`, storeErr instanceof Error ? storeErr.message : String(storeErr));
  }
}

async function runJob(store: GenerationStore, storage: HumanizedFileStorage, record: GenerationRecord, live: LiveJob, reservation: ActiveReservation, input: JobInput): Promise<void> {
  const { userId, id } = record;
  try {
    live.stage = 'analyzing';
    // Detect the plan's aspect ratio, pick the nearest supported size and add neutral margins only if needed (never stretch / squeeze / crop).
    const canvas = await prepareFloorplanCanvas(input.originalBuffer, input.originalMime, record.outputFormat as HumanizedFloorplanOutputFormat);
    const prompt = buildHumanizedFloorplanPrompt({
      style: record.style as HumanizedFloorplanSimpleStyle,
      lighting: record.lighting as HumanizedFloorplanLighting,
      surroundings: record.surroundings as HumanizedFloorplanSurroundings,
      surroundingsKind: record.surroundingsKind as HumanizedFloorplanSurroundingsKind | null,
      customSurroundings: record.customSurroundings,
      textMode: record.textMode as HumanizedFloorplanTextMode,
      furnitureLevel: record.furnitureLevel as HumanizedFloorplanFurnitureLevel,
      outputFormat: record.outputFormat as HumanizedFloorplanOutputFormat,
      hasStyleReference: record.hasReference,
      customInstructions: record.customInstructions,
      canvasPadded: canvas.padded,
    });

    live.stage = 'generating';
    const generated = await generateHumanizedFloorplanImage({
      originalImageBuffer: canvas.buffer,
      originalImageMimeType: canvas.mime,
      styleReferenceBuffer: input.referenceBuffer,
      styleReferenceMimeType: input.referenceMime,
      prompt,
      size: canvas.size,
    });

    live.stage = 'finalizing';
    const validation = validateGeneratedFloorplanPng(generated.pngBuffer);
    if (!validation.valid) throw new AppError('GENERATION_FAILED', 'OpenAI returned an invalid or unreadable image.', validation.reasons.join('; '), 502);

    let resultPath: string;
    let resultJpgPath: string | null = null;
    try {
      resultPath = await storage.save(userId, id, 'result', generated.pngBuffer, 'image/png');
      const jpg = await makeJpg(generated.pngBuffer);
      if (jpg) resultJpgPath = await storage.save(userId, id, 'result', jpg, 'image/jpeg').catch(() => null);
    } catch {
      throw new AppError('RESULT_IMAGE_UNAVAILABLE', 'The generated image could not be saved.', undefined, 500);
    }
    // The generation only counts as delivered if the saved image can actually be read back.
    if (!(await storage.exists(resultPath).catch(() => false))) {
      throw new AppError('RESULT_IMAGE_UNAVAILABLE', 'The generated image could not be saved.', undefined, 500);
    }

    // Recorded BEFORE the capture: if the process dies between here and the capture, reconciliation sees a saved result and captures instead of refunding.
    const costUsd = estimateOpenAiImageCostUsd(generated.usage);
    await store.update(userId, id, { resultPath, resultJpgPath, usage: generated.usage, costUsd, quality: generated.effectiveQuality, size: generated.effectiveSize, requestId: generated.requestId });

    const captured = await captureCredits(reservation);
    await store.update(userId, id, {
      status: 'completed',
      creditsCaptured: captured.captured,
      creditsRefunded: captured.refunded,
      captureTransactionId: captured.captureId,
      refundTransactionId: captured.refundId,
      completedAt: new Date().toISOString(),
    });
    live.stage = 'complete';

    recordGeneration({
      generationId: id,
      timestamp: live.startedAt,
      engine: 'openai-image-simple',
      provider: 'openai-image',
      model: OPENAI_BLOCK_IMAGE_MODEL,
      creditsCharged: captured.captured,
      status: 'complete',
      resolution: validation.width && validation.height ? { width: validation.width, height: validation.height } : null,
      hasReferenceRender: record.hasReference,
    });
  } catch (err) {
    const failure = sanitizedFailure(err);
    if (err instanceof AppError) serverLogger.error(`Humanized floor plan generation ${id} failed`, { code: err.code });
    else serverLogger.error(`Humanized floor plan generation ${id} failed unexpectedly`, err instanceof Error ? err.message : String(err));
    live.stage = 'error';
    await failGeneration(store, userId, id, reservation, failure);

    recordGeneration({
      generationId: id,
      timestamp: live.startedAt,
      engine: 'openai-image-simple',
      provider: 'openai-image',
      model: OPENAI_BLOCK_IMAGE_MODEL,
      creditsCharged: 0,
      status: 'error',
      resolution: null,
      hasReferenceRender: record.hasReference,
    });
  } finally {
    markGenerationDone(id);
    setTimeout(() => {
      liveJobs.delete(id);
      for (const [k, v] of idempotencyClaims) if (v.id === id) idempotencyClaims.delete(k);
    }, 30 * 60 * 1000).unref();
  }
}

/**
 * The Astra job: the pipeline (one Astra analysis, one Sunburst generation)
 * produces ONE image; if it is valid it is stored as the result, read back,
 * and the credits captured. It is never rejected by a score or a validation.
 * Any technical failure (error, no image, could not save) refunds in full.
 */
async function runAstraJob(store: GenerationStore, storage: HumanizedFileStorage, record: GenerationRecord, live: LiveJob, reservation: ActiveReservation, input: JobInput): Promise<void> {
  const { userId, id } = record;
  const setStage = async (stage: string): Promise<void> => {
    live.stage = stage as HumanizedFloorplanSimpleJobStage;
    await store.update(userId, id, { pipelineStage: stage }).catch(() => undefined);
  };
  try {
    const result = await runAstraPipeline({
      userId,
      generationId: id,
      record,
      original: { buffer: input.originalBuffer, mime: input.originalMime },
      reference: input.referenceBuffer ? { buffer: input.referenceBuffer, mime: input.referenceMime ?? 'image/png' } : null,
      storage,
      setStage,
      patchRecord: (patch) => store.update(userId, id, patch),
      saveStep: (step) => store.saveStep(userId, id, step),
    });

    await setStage('finalizing');
    const validation = validateGeneratedFloorplanPng(result.finalPng);
    if (!validation.valid) throw new AppError('GENERATION_FAILED', 'The generated image was invalid or unreadable.', undefined, 502);

    let resultPath: string;
    let resultJpgPath: string | null = null;
    try {
      resultPath = await storage.save(userId, id, 'result', result.finalPng, 'image/png');
      const jpg = await makeJpg(result.finalPng);
      if (jpg) resultJpgPath = await storage.save(userId, id, 'result', jpg, 'image/jpeg').catch(() => null);
    } catch {
      throw new AppError('RESULT_IMAGE_UNAVAILABLE', 'The generated image could not be saved.', undefined, 500);
    }
    if (!(await storage.exists(resultPath).catch(() => false))) {
      throw new AppError('RESULT_IMAGE_UNAVAILABLE', 'The generated image could not be saved.', undefined, 500);
    }

    // Recorded BEFORE the capture (see the standard job): a crash in between is reconciled as "delivered", not refunded.
    await store.update(userId, id, {
      resultPath,
      resultJpgPath,
      usage: result.imageUsage,
      costUsd: result.totalCostUsd,
      quality: result.effectiveQuality,
      size: result.effectiveSize,
      requestId: result.lastImageRequestId,
    });

    const captured = await captureCredits(reservation);
    await store.update(userId, id, {
      status: 'completed',
      creditsCaptured: captured.captured,
      creditsRefunded: captured.refunded,
      captureTransactionId: captured.captureId,
      refundTransactionId: captured.refundId,
      pipelineStage: 'complete',
      completedAt: new Date().toISOString(),
    });
    live.stage = 'complete';

    recordGeneration({
      generationId: id,
      timestamp: live.startedAt,
      engine: 'openai-image-astra',
      provider: 'openai-image',
      model: OPENAI_BLOCK_IMAGE_MODEL,
      creditsCharged: captured.captured,
      status: 'complete',
      resolution: validation.width && validation.height ? { width: validation.width, height: validation.height } : null,
      hasReferenceRender: record.hasReference,
    });
  } catch (err) {
    const failure = sanitizedFailure(err);
    if (err instanceof AppError) serverLogger.error('Humanized floor plan (astra) generation ' + id + ' failed', { code: err.code });
    else serverLogger.error('Humanized floor plan (astra) generation ' + id + ' failed unexpectedly', err instanceof Error ? err.message : String(err));
    live.stage = 'error';
    await failGeneration(store, userId, id, reservation, failure);
    await store.update(userId, id, { pipelineStage: 'error' }).catch(() => undefined);

    recordGeneration({
      generationId: id,
      timestamp: live.startedAt,
      engine: 'openai-image-astra',
      provider: 'openai-image',
      model: OPENAI_BLOCK_IMAGE_MODEL,
      creditsCharged: 0,
      status: 'error',
      resolution: null,
      hasReferenceRender: record.hasReference,
    });
  } finally {
    markGenerationDone(id);
    setTimeout(() => {
      liveJobs.delete(id);
      for (const [k, v] of idempotencyClaims) if (v.id === id) idempotencyClaims.delete(k);
    }, 30 * 60 * 1000).unref();
  }
}
