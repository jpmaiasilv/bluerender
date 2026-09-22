import { Router, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import sizeOf from 'image-size';
import { AppError } from '../lib/errors';
import { serverLogger, topazLogger } from '../lib/logger';
import { detectImageMimeType } from '../lib/fileSignature';
import { requireAuth, AuthenticatedRequest } from '../middleware/requireAuth';
import { ActiveReservation, captureCredits, refundCredits, reserveCredits } from '../services/creditWallet';
import { recordGeneration } from '../services/generationLog';
import {
  creditsForScale,
  isUpscaleScale,
  isTopazConfigured,
  TOPAZ_MAX_INPUT_MEGAPIXELS,
  TOPAZ_MAX_OUTPUT_MEGAPIXELS,
  TOPAZ_MODEL,
  UpscaleScale,
  UPSCALE_SCALES,
} from '../config/topaz';
import { cancelEnhanceJob, createEnhanceJob, downloadEnhanceResult, getEnhanceStatus } from '../providers/topazClient';
import {
  getUpscaleFileStorage,
  upscaleContentTypeForPath,
  verifyUpscaleFileToken,
} from '../storage/upscaleFiles';
import { getUpscaleStore, UpscaleJobRecord, UpscaleStatus } from '../services/upscaleStore';

const MAX_FILE_SIZE = 500 * 1024 * 1024; // matches Topaz's own request size cap
const JOB_TTL_MS = 30 * 60 * 1000;
// High Fidelity V2 on a large image can genuinely take minutes — longer budget than a render.
const TOPAZ_POLL_TIMEOUT_MS = Number(process.env.TOPAZ_POLL_TIMEOUT_MS) || 10 * 60 * 1000;
const POLL_START_DELAY_MS = 3000;
const POLL_MAX_DELAY_MS = 12000;
const POLL_BACKOFF_FACTOR = 1.5;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } });
const uploadFields = upload.fields([{ name: 'image', maxCount: 1 }]);

type LiveStage =
  | 'validating'
  | 'uploading'
  | 'queued'
  | 'processing'
  | 'downloading'
  | 'saving'
  | 'complete'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

interface LiveJob {
  id: string;
  userId: string;
  stage: LiveStage;
  startedAt: number;
  result?: UpscaleResultPayload;
  error?: { code: string; message: string; details?: string };
}

export interface UpscaleResultPayload {
  jobId: string;
  originalUrl: string;
  resultUrl: string;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  scale: UpscaleScale;
  model: string;
  creditsCharged: number;
}

const jobs = new Map<string, LiveJob>();
/** `${userId}:${idempotencyKey}` -> jobId. Claimed synchronously so a double-click (or a retried request) never starts a second Topaz job or reserves credits twice. */
const idempotencyClaims = new Map<string, string>();

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.startedAt > JOB_TTL_MS) jobs.delete(id);
  }
}, 5 * 60 * 1000).unref();

export const upscaleRouter = Router();

upscaleRouter.get('/upscale/config', (_req: Request, res: Response) => {
  res.json({
    model: TOPAZ_MODEL,
    scales: UPSCALE_SCALES.map((scale) => ({ scale, credits: creditsForScale(scale) })),
    maxInputMegapixels: TOPAZ_MAX_INPUT_MEGAPIXELS,
    maxOutputMegapixels: TOPAZ_MAX_OUTPUT_MEGAPIXELS,
    acceptedTypes: ['image/jpeg', 'image/png'],
  });
});

function sendError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    res.status(err.httpStatus).json({ error: { code: err.code, message: err.message } });
    return;
  }
  serverLogger.error('Unexpected error handling upscale request', err instanceof Error ? err.message : String(err));
  res.status(500).json({ error: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred.' } });
}

function megapixels(width: number, height: number): number {
  return (width * height) / 1_000_000;
}

upscaleRouter.post('/upscale/generate', requireAuth, uploadFields, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user!.id;
  let reservation: ActiveReservation | null = null;
  let claimKey: string | null = null;

  try {
    if (!isTopazConfigured()) {
      throw new AppError('PROVIDER_UNAVAILABLE', 'Upscale IA is temporarily unavailable.', 'TOPAZ_API_KEY is not configured', 503);
    }

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const file = files?.image?.[0];
    if (!file) throw new AppError('VALIDATION_ERROR', 'Please choose an image to upscale.', undefined, 400);

    const scaleRaw = Number(req.body.scale);
    if (!isUpscaleScale(scaleRaw)) throw new AppError('VALIDATION_ERROR', 'Choose 2x or 4x.', undefined, 400);
    const scale = scaleRaw;

    // Magic-byte sniffing, never the client-declared mimetype — and Topaz
    // itself only accepts jpeg/png/tiff; this platform only accepts
    // jpeg/png from the browser (webp is rejected: Topaz does not support it).
    const mime = detectImageMimeType(file.buffer);
    if (mime !== 'image/png' && mime !== 'image/jpeg') {
      throw new AppError(
        'IMAGE_UPLOAD_FAILED',
        'Unsupported format. Please upload a JPG or PNG file (Topaz does not accept WEBP).',
        `Declared mimetype: ${file.mimetype}`,
        400
      );
    }

    const dims = sizeOf(file.buffer);
    if (!dims.width || !dims.height) {
      throw new AppError('IMAGE_UPLOAD_FAILED', 'Could not read the uploaded image dimensions.', undefined, 400);
    }
    const { width: originalWidth, height: originalHeight } = dims;

    if (megapixels(originalWidth, originalHeight) > TOPAZ_MAX_INPUT_MEGAPIXELS) {
      throw new AppError(
        'VALIDATION_ERROR',
        `This image is too large to upscale (max ${TOPAZ_MAX_INPUT_MEGAPIXELS} megapixels).`,
        `${originalWidth}x${originalHeight}`,
        400
      );
    }

    const outputWidth = originalWidth * scale;
    const outputHeight = originalHeight * scale;
    if (megapixels(outputWidth, outputHeight) > TOPAZ_MAX_OUTPUT_MEGAPIXELS) {
      throw new AppError(
        'VALIDATION_ERROR',
        `${scale}x would exceed the maximum output size (max ${TOPAZ_MAX_OUTPUT_MEGAPIXELS} megapixels). Try a smaller scale or a smaller original image.`,
        `${outputWidth}x${outputHeight}`,
        400
      );
    }

    const idempotencyKey = typeof req.body.idempotencyKey === 'string' && req.body.idempotencyKey.trim() ? req.body.idempotencyKey.trim() : null;
    if (idempotencyKey) {
      claimKey = `${userId}:${idempotencyKey}`;
      const existingJobId = idempotencyClaims.get(claimKey);
      if (existingJobId) {
        res.status(202).json({ jobId: existingJobId, startedAt: jobs.get(existingJobId)?.startedAt ?? Date.now() });
        return;
      }
      idempotencyClaims.set(claimKey, 'pending');
    }

    const store = await getUpscaleStore();
    if (idempotencyKey) {
      const existing = await store.findByIdempotencyKey(userId, idempotencyKey);
      if (existing) {
        res.status(202).json({ jobId: existing.id, startedAt: new Date(existing.createdAt).getTime() });
        if (claimKey) idempotencyClaims.set(claimKey, existing.id);
        return;
      }
    }

    const credits = creditsForScale(scale);
    const jobId = crypto.randomUUID();
    reservation = await reserveCredits({ userId, amount: credits, tool: 'upscale', generationId: jobId, idempotencyKey });
    if (claimKey) idempotencyClaims.set(claimKey, jobId);

    const record: UpscaleJobRecord = {
      id: jobId,
      userId,
      idempotencyKey,
      status: 'queued',
      provider: 'topaz',
      providerProcessId: null,
      model: TOPAZ_MODEL,
      scale,
      originalWidth,
      originalHeight,
      outputWidth,
      outputHeight,
      originalPath: null,
      resultPath: null,
      creditsReserved: credits,
      creditsCaptured: 0,
      creditsRefunded: 0,
      reservationId: reservation.id,
      captureTransactionId: null,
      refundTransactionId: null,
      errorCode: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    };
    await store.insert(record);

    const job: LiveJob = { id: jobId, userId, stage: 'validating', startedAt: Date.now() };
    jobs.set(jobId, job);

    res.status(202).json({ jobId, startedAt: job.startedAt });

    void runJob(job, reservation, record, { buffer: file.buffer, mime });
  } catch (err) {
    if (reservation) await refundCredits(reservation, 'request_failed');
    if (claimKey) idempotencyClaims.delete(claimKey);
    sendError(res, err);
  }
});

upscaleRouter.get('/upscale/generate/:jobId', requireAuth, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user!.id;
  const job = jobs.get(req.params.jobId);
  // 404 (not 403) for a job that exists but belongs to someone else — never
  // confirms another user's job id is valid.
  if (!job || job.userId !== userId) {
    res.status(404).json({ error: { code: 'UNKNOWN_ERROR', message: 'Job not found. It may have expired.' } });
    return;
  }
  res.json({ jobId: job.id, stage: job.stage, startedAt: job.startedAt, result: job.result, error: job.error });
});

upscaleRouter.get('/upscale/history', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const store = await getUpscaleStore();
    const records = await store.list(userId, 50);
    const storage = await getUpscaleFileStorage();
    const items = await Promise.all(
      records.map(async (r) => ({
        id: r.id,
        status: r.status,
        scale: r.scale,
        model: r.model,
        originalWidth: r.originalWidth,
        originalHeight: r.originalHeight,
        outputWidth: r.outputWidth,
        outputHeight: r.outputHeight,
        creditsCharged: r.creditsCaptured,
        createdAt: r.createdAt,
        originalUrl: r.originalPath ? await storage.signedUrl(r.originalPath) : null,
        resultUrl: r.resultPath ? await storage.signedUrl(r.resultPath) : null,
      }))
    );
    res.json({ items });
  } catch (err) {
    sendError(res, err);
  }
});

/** Local-disk signed links — exists ONLY while the explicit dev fallback is active. */
upscaleRouter.get('/upscale/file', async (req: Request, res: Response) => {
  try {
    const storage = await getUpscaleFileStorage().catch(() => null);
    if (!storage || storage.backend !== 'local') {
      res.status(404).json({ error: { code: 'RESULT_IMAGE_UNAVAILABLE', message: 'Not found.' } });
      return;
    }
    const claims = verifyUpscaleFileToken(typeof req.query.token === 'string' ? req.query.token : '');
    if (!claims) {
      res.status(403).json({ error: { code: 'UNAUTHENTICATED', message: 'This link is invalid or has expired.' } });
      return;
    }
    const buffer = await storage.read(claims.path);
    if (!buffer) {
      res.status(404).json({ error: { code: 'RESULT_IMAGE_UNAVAILABLE', message: 'The file is no longer available.' } });
      return;
    }
    res.setHeader('Content-Type', upscaleContentTypeForPath(claims.path));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(buffer);
  } catch (err) {
    sendError(res, err);
  }
});

interface JobInput {
  buffer: Buffer;
  mime: 'image/png' | 'image/jpeg';
}

async function updateStatus(store: Awaited<ReturnType<typeof getUpscaleStore>>, record: UpscaleJobRecord, patch: Partial<UpscaleJobRecord>): Promise<void> {
  Object.assign(record, patch, { updatedAt: new Date().toISOString() });
  await store.update(record.userId, record.id, { ...patch, updatedAt: record.updatedAt });
}

async function runJob(job: LiveJob, reservation: ActiveReservation, record: UpscaleJobRecord, input: JobInput): Promise<void> {
  const store = await getUpscaleStore();
  const startedAt = job.startedAt;
  let providerProcessId: string | null = null;

  try {
    job.stage = 'uploading';
    const storage = await getUpscaleFileStorage();
    const originalPath = await storage.save(record.userId, record.id, 'original', input.buffer, input.mime);
    await updateStatus(store, record, { originalPath });

    job.stage = 'queued';
    const outputFormat: 'jpeg' | 'png' = input.mime === 'image/png' ? 'png' : 'jpeg';
    const enhanceJob = await createEnhanceJob({
      imageBuffer: input.buffer,
      inputMime: input.mime,
      outputWidth: record.outputWidth,
      outputHeight: record.outputHeight,
      outputFormat,
    });
    providerProcessId = enhanceJob.processId;
    await updateStatus(store, record, { status: 'processing', providerProcessId });

    job.stage = 'processing';
    const remoteStatus = await pollUntilDone(providerProcessId);

    if (remoteStatus === 'Failed') {
      throw new AppError('GENERATION_FAILED', 'Topaz failed to upscale this image.', undefined, 502);
    }
    if (remoteStatus === 'Cancelled') {
      throw new AppError('GENERATION_FAILED', 'The upscale job was cancelled.', undefined, 502);
    }

    job.stage = 'downloading';
    const resultBuffer = await downloadEnhanceResult(providerProcessId);
    if (resultBuffer.length === 0) throw new AppError('RESULT_IMAGE_UNAVAILABLE', 'Topaz returned an empty result.', undefined, 502);

    job.stage = 'saving';
    const resultMime: 'image/png' | 'image/jpeg' = outputFormat === 'png' ? 'image/png' : 'image/jpeg';
    const resultPath = await storage.save(record.userId, record.id, 'result', resultBuffer, resultMime);

    const creditsCharged = record.creditsReserved;
    await captureCredits(reservation, creditsCharged);
    await updateStatus(store, record, {
      status: 'completed',
      resultPath,
      creditsCaptured: creditsCharged,
      captureTransactionId: reservation.id,
      completedAt: new Date().toISOString(),
    });

    const [originalUrl, resultUrl] = await Promise.all([storage.signedUrl(originalPath), storage.signedUrl(resultPath)]);
    job.result = {
      jobId: job.id,
      originalUrl: originalUrl ?? '',
      resultUrl: resultUrl ?? '',
      originalWidth: record.originalWidth,
      originalHeight: record.originalHeight,
      outputWidth: record.outputWidth,
      outputHeight: record.outputHeight,
      scale: record.scale,
      model: record.model,
      creditsCharged,
    };
    job.stage = 'complete';

    recordGeneration({
      generationId: job.id,
      timestamp: startedAt,
      engine: `upscale_${record.scale}x`,
      provider: 'topaz',
      model: record.model,
      creditsCharged,
      status: 'complete',
      resolution: { width: record.outputWidth, height: record.outputHeight },
      hasReferenceRender: true,
    });
  } catch (err) {
    const isTimeout = err instanceof AppError && err.code === 'GENERATION_TIMEOUT';
    job.stage = isTimeout ? 'timed_out' : 'failed';
    await refundCredits(reservation, isTimeout ? 'generation_timeout' : 'generation_failed');

    if (providerProcessId) void cancelEnhanceJob(providerProcessId);

    const payload = err instanceof AppError ? err.toPayload() : { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred during upscaling.', details: err instanceof Error ? err.message : String(err) };
    job.error = payload;

    await updateStatus(store, record, {
      status: (isTimeout ? 'timed_out' : 'failed') as UpscaleStatus,
      creditsRefunded: record.creditsReserved,
      errorCode: payload.code,
      errorMessage: payload.message.slice(0, 500),
    });

    if (!(err instanceof AppError)) {
      topazLogger.error(`Upscale job ${job.id} failed unexpectedly`, err instanceof Error ? err.message : String(err));
    }

    recordGeneration({
      generationId: job.id,
      timestamp: startedAt,
      engine: `upscale_${record.scale}x`,
      provider: 'topaz',
      model: record.model,
      creditsCharged: 0,
      status: 'error',
      resolution: null,
      hasReferenceRender: true,
    });
  }
}

async function pollUntilDone(processId: string): Promise<'Completed' | 'Failed' | 'Cancelled'> {
  const startedAt = Date.now();
  let delay = POLL_START_DELAY_MS;

  while (Date.now() - startedAt < TOPAZ_POLL_TIMEOUT_MS) {
    const { status } = await getEnhanceStatus(processId);
    if (status === 'Completed' || status === 'Failed' || status === 'Cancelled') return status;
    topazLogger.log(`Processing (status=${status})`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * POLL_BACKOFF_FACTOR, POLL_MAX_DELAY_MS);
  }

  throw new AppError('GENERATION_TIMEOUT', 'The upscale took too long to complete.', `Exceeded ${TOPAZ_POLL_TIMEOUT_MS}ms polling timeout`, 504);
}
