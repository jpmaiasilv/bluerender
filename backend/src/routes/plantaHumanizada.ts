import { Router, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import sizeOf from 'image-size';
import { AppError } from '../lib/errors';
import { buildPlantaCleanupPrompt, buildPlantaHumanizadaPrompt } from '../lib/plantaHumanizadaPromptBuilder';
import { computeTargetDimensions } from '../lib/imageDimensions';
import { detectImageMimeType } from '../lib/fileSignature';
import { getProvider } from '../providers/registry';
import { RenderProvider } from '../providers/types';
import { readResultFile, saveResultImage } from '../storage/resultStore';
import { serverLogger } from '../lib/logger';
import { getPlantaEngineOption, listPlantaEngineOptions, PLANTA_CLEANUP_CREDITS, PlantaEngineOption } from '../config/plantaEngines';
import { ActiveReservation, captureCredits, refundCredits, reserveCredits } from '../services/creditWallet';
import { requireAuth, AuthenticatedRequest } from '../middleware/requireAuth';
import { recordGeneration } from '../services/generationLog';
import { PlantaCreateJobResponse, PlantaHumanizadaSettings, PlantaJobStatusResponse, PlantaRenderStyle } from '../types/plantaHumanizada';
import { JobStage } from '../types/api';

// crypto.randomUUID() format — validated before ever being used to build a filesystem path (see /cleanup).
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
const JOB_TTL_MS = 30 * 60 * 1000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

const uploadFields = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'referenceImage', maxCount: 1 },
]);

interface Job {
  id: string;
  stage: JobStage;
  providerStatus?: string;
  startedAt: number;
  result?: PlantaJobStatusResponse['result'];
  error?: PlantaJobStatusResponse['error'];
}

const jobs = new Map<string, Job>();

// Sweep abandoned jobs so the in-memory map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.startedAt > JOB_TTL_MS) jobs.delete(id);
  }
}, 5 * 60 * 1000).unref();

export const plantaHumanizadaRouter = Router();

plantaHumanizadaRouter.get('/planta-humanizada/engines', (_req: Request, res: Response) => {
  res.json({ engines: listPlantaEngineOptions() });
});

function parseSettings(body: Record<string, string>): PlantaHumanizadaSettings {
  const required = ['renderStyle', 'engine'];
  for (const key of required) {
    if (!body[key]) {
      throw new AppError('VALIDATION_ERROR', `Missing required field: ${key}`, undefined, 400);
    }
  }

  return {
    renderStyle: body.renderStyle as PlantaRenderStyle,
    customInstructions: body.customInstructions?.trim() || undefined,
    engine: body.engine as PlantaHumanizadaSettings['engine'],
  };
}

function validateImage(file: Express.Multer.File | undefined, label: string, required: boolean): string | null {
  if (!file) {
    if (required) throw new AppError('IMAGE_UPLOAD_FAILED', `No ${label} file was received.`, undefined, 400);
    return null;
  }
  const detected = detectImageMimeType(file.buffer);
  if (!detected) {
    throw new AppError(
      'IMAGE_UPLOAD_FAILED',
      `Unsupported ${label} format. Please upload a JPG, PNG or WEBP file.`,
      `Declared mimetype: ${file.mimetype}`,
      400
    );
  }
  return detected;
}

plantaHumanizadaRouter.post('/planta-humanizada/generate', requireAuth, uploadFields, async (req: Request, res: Response) => {
  let reservation: ActiveReservation | null = null;
  try {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const imageFile = files?.image?.[0];
    const referenceFile = files?.referenceImage?.[0];

    const imageMimeType = validateImage(imageFile, 'floor plan image', true);
    const referenceMimeType = validateImage(referenceFile, 'reference image', false);

    const settings = parseSettings(req.body);

    const engineOption = getPlantaEngineOption(settings.engine);
    if (!engineOption) {
      throw new AppError('VALIDATION_ERROR', `Unknown engine: ${settings.engine}`, undefined, 400);
    }


    const provider = getProvider(engineOption.providerId);
    if (!provider || !provider.models.some((m) => m.id === engineOption.modelId)) {
      // Can only happen from a config typo in config/plantaEngines.ts, never from client input.
      serverLogger.error('Planta Humanizada engine config references an unknown provider/model', engineOption);
      throw new AppError('PROVIDER_UNAVAILABLE', 'This engine is temporarily unavailable.', undefined, 500);
    }

    const jobId = crypto.randomUUID();
    reservation = await reserveCredits({ userId: (req as AuthenticatedRequest).user!.id, amount: engineOption.credits, tool: 'planta_render', generationId: jobId });
    const job: Job = { id: jobId, stage: 'uploading', startedAt: Date.now() };
    jobs.set(jobId, job);

    const response: PlantaCreateJobResponse = { jobId, startedAt: job.startedAt };
    res.status(202).json(response);

    void runJob(job, reservation, provider, engineOption, settings, {
      buffer: imageFile!.buffer,
      mimeType: imageMimeType!,
      referenceBuffer: referenceFile?.buffer,
      referenceMimeType: referenceMimeType ?? undefined,
    });
  } catch (err) {
    if (reservation) await refundCredits(reservation, 'request_failed');
    handleSyncError(res, err);
  }
});

plantaHumanizadaRouter.get('/planta-humanizada/generate/:jobId', (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: { code: 'UNKNOWN_ERROR', message: 'Job not found. It may have expired.' } });
    return;
  }
  const payload: PlantaJobStatusResponse = {
    jobId: job.id,
    stage: job.stage,
    providerStatus: job.providerStatus,
    startedAt: job.startedAt,
    result: job.result,
    error: job.error,
  };
  res.json(payload);
});

/**
 * "Limpeza Técnica" — cleans up an ALREADY generated Planta Humanizada image
 * (dimension marks, room numbers, embedded text), rather than generating a
 * new one from a fresh upload. Reuses the exact same job-tracking map and
 * polling endpoint above (GET /planta-humanizada/generate/:jobId) — a
 * cleanup job is just another entry in `jobs`, with the same shape, so the
 * frontend polls it exactly like a normal generation.
 *
 * There is no masked-inpainting primitive in this backend (providers/bfl.ts
 * only ever sends a whole input_image) — this works by resubmitting the
 * generated image through the same image-to-image call with a prompt that
 * asks only for the markup to be erased, never anything else to change.
 */
plantaHumanizadaRouter.post('/planta-humanizada/cleanup', requireAuth, async (req: Request, res: Response) => {
  let reservation: ActiveReservation | null = null;
  try {
    const requestId = req.body?.requestId;
    if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) {
      throw new AppError('VALIDATION_ERROR', 'Missing or invalid requestId.', undefined, 400);
    }

    const existing = readResultFile(requestId);
    if (!existing) {
      throw new AppError('IMAGE_UPLOAD_FAILED', 'The image to clean up was not found. It may have expired.', undefined, 404);
    }

    // Always the cheapest tier's underlying model — cleanup is a light, fixed-cost
    // follow-up action, independent of which tier the original render used.
    const engineOption = getPlantaEngineOption('fast')!;


    const provider = getProvider(engineOption.providerId);
    if (!provider || !provider.models.some((m) => m.id === engineOption.modelId)) {
      serverLogger.error('Planta Humanizada cleanup engine config references an unknown provider/model', engineOption);
      throw new AppError('PROVIDER_UNAVAILABLE', 'This engine is temporarily unavailable.', undefined, 500);
    }

    const jobId = crypto.randomUUID();
    reservation = await reserveCredits({ userId: (req as AuthenticatedRequest).user!.id, amount: PLANTA_CLEANUP_CREDITS, tool: 'planta_cleanup', generationId: jobId });
    const job: Job = { id: jobId, stage: 'uploading', startedAt: Date.now() };
    jobs.set(jobId, job);

    const response: PlantaCreateJobResponse = { jobId, startedAt: job.startedAt };
    res.status(202).json(response);

    void runCleanupJob(job, reservation, provider, engineOption, existing);
  } catch (err) {
    if (reservation) await refundCredits(reservation, 'request_failed');
    handleSyncError(res, err);
  }
});

function handleSyncError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    res.status(err.httpStatus).json({ error: err.toPayload() });
    return;
  }
  serverLogger.error('Unexpected error handling Planta Humanizada request', err);
  res.status(500).json({ error: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred.' } });
}

interface JobInput {
  buffer: Buffer;
  mimeType: string;
  referenceBuffer?: Buffer;
  referenceMimeType?: string;
}

async function runJob(
  job: Job,
  reservation: ActiveReservation,
  provider: RenderProvider,
  engineOption: PlantaEngineOption,
  settings: PlantaHumanizadaSettings,
  input: JobInput
): Promise<void> {
  const startedAt = job.startedAt;
  const hasReferenceImage = Boolean(input.referenceBuffer);
  try {
    job.stage = 'uploading';
    // Always preserves the source floor plan's own aspect ratio — there is no
    // user-facing aspect ratio control for this tool (the geometry, including
    // its proportions, must never change).
    const dims = sizeOf(input.buffer);
    if (!dims.width || !dims.height) {
      throw new AppError('IMAGE_UPLOAD_FAILED', 'Could not read the uploaded image dimensions.', undefined, 400);
    }
    const target = computeTargetDimensions(dims.width, dims.height);

    const imageBase64 = input.buffer.toString('base64');
    const referenceImageBase64 = input.referenceBuffer?.toString('base64');
    const prompt = buildPlantaHumanizadaPrompt(settings);
    const outputFormat = input.mimeType === 'image/png' ? 'png' : 'jpeg';

    job.stage = 'sending';
    const result = await provider.generateRender(engineOption.modelId, {
      prompt,
      imageBase64,
      referenceImageBase64,
      width: target.width,
      height: target.height,
      outputFormat,
      onProviderStatus: (status) => {
        job.providerStatus = status;
        job.stage = 'rendering';
      },
    });

    job.stage = 'downloading';
    const resultDims = sizeOf(result.imageBuffer);
    const imageUrl = saveResultImage(result.requestId, result.imageBuffer, result.contentType);
    const resolution = resultDims.width && resultDims.height ? { width: resultDims.width, height: resultDims.height } : null;

    // Charge exactly once, only now that the generation has genuinely completed.
    await captureCredits(reservation);

    job.result = {
      requestId: result.requestId,
      engine: engineOption.id,
      provider: provider.id,
      model: engineOption.modelId,
      imageUrl,
      prompt,
      generationTimeMs: Date.now() - startedAt,
      resolution,
      status: 'Ready',
      creditsCharged: engineOption.credits,
    };
    job.stage = 'complete';

    recordGeneration({
      generationId: job.id,
      timestamp: startedAt,
      engine: engineOption.id,
      provider: provider.id,
      model: engineOption.modelId,
      creditsCharged: engineOption.credits,
      status: 'complete',
      resolution,
      hasReferenceRender: hasReferenceImage,
    });
  } catch (err) {
    job.stage = 'error';
    await refundCredits(reservation, 'generation_failed');
    if (err instanceof AppError) {
      job.error = err.toPayload();
    } else {
      serverLogger.error(`Planta Humanizada job ${job.id} failed unexpectedly`, err);
      job.error = {
        code: 'UNKNOWN_ERROR',
        message: 'An unexpected error occurred during generation.',
        details: err instanceof Error ? err.message : String(err),
      };
    }

    recordGeneration({
      generationId: job.id,
      timestamp: startedAt,
      engine: engineOption.id,
      provider: provider.id,
      model: engineOption.modelId,
      creditsCharged: 0,
      status: 'error',
      resolution: null,
      hasReferenceRender: hasReferenceImage,
    });
  }
}

async function runCleanupJob(
  job: Job,
  reservation: ActiveReservation,
  provider: RenderProvider,
  engineOption: PlantaEngineOption,
  source: { buffer: Buffer; contentType: string }
): Promise<void> {
  const startedAt = job.startedAt;
  try {
    job.stage = 'uploading';
    const dims = sizeOf(source.buffer);
    if (!dims.width || !dims.height) {
      throw new AppError('IMAGE_UPLOAD_FAILED', 'Could not read the source image dimensions.', undefined, 400);
    }
    const target = computeTargetDimensions(dims.width, dims.height);

    const imageBase64 = source.buffer.toString('base64');
    const prompt = buildPlantaCleanupPrompt();
    const outputFormat = source.contentType === 'image/png' ? 'png' : 'jpeg';

    job.stage = 'sending';
    const result = await provider.generateRender(engineOption.modelId, {
      prompt,
      imageBase64,
      width: target.width,
      height: target.height,
      outputFormat,
      onProviderStatus: (status) => {
        job.providerStatus = status;
        job.stage = 'rendering';
      },
    });

    job.stage = 'downloading';
    const resultDims = sizeOf(result.imageBuffer);
    const imageUrl = saveResultImage(result.requestId, result.imageBuffer, result.contentType);
    const resolution = resultDims.width && resultDims.height ? { width: resultDims.width, height: resultDims.height } : null;

    // Fixed, discounted cost — never the full engine tier price (see PLANTA_CLEANUP_CREDITS).
    await captureCredits(reservation);

    job.result = {
      requestId: result.requestId,
      engine: engineOption.id,
      provider: provider.id,
      model: engineOption.modelId,
      imageUrl,
      prompt,
      generationTimeMs: Date.now() - startedAt,
      resolution,
      status: 'Ready',
      creditsCharged: PLANTA_CLEANUP_CREDITS,
      cleaned: true,
    };
    job.stage = 'complete';

    recordGeneration({
      generationId: job.id,
      timestamp: startedAt,
      engine: engineOption.id,
      provider: provider.id,
      model: engineOption.modelId,
      creditsCharged: PLANTA_CLEANUP_CREDITS,
      status: 'complete',
      resolution,
      hasReferenceRender: false,
    });
  } catch (err) {
    job.stage = 'error';
    await refundCredits(reservation, 'generation_failed');
    if (err instanceof AppError) {
      job.error = err.toPayload();
    } else {
      serverLogger.error(`Planta Humanizada cleanup job ${job.id} failed unexpectedly`, err);
      job.error = {
        code: 'UNKNOWN_ERROR',
        message: 'An unexpected error occurred during cleanup.',
        details: err instanceof Error ? err.message : String(err),
      };
    }

    recordGeneration({
      generationId: job.id,
      timestamp: startedAt,
      engine: engineOption.id,
      provider: provider.id,
      model: engineOption.modelId,
      creditsCharged: 0,
      status: 'error',
      resolution: null,
      hasReferenceRender: false,
    });
  }
}
