import { Router, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import sizeOf from 'image-size';
import { AppError } from '../lib/errors';
import { buildArchitecturalPrompt } from '../lib/promptBuilder';
import { computeDimensionsForAspectRatio } from '../lib/imageDimensions';
import { detectImageMimeType } from '../lib/fileSignature';
import { getProvider } from '../providers/registry';
import { RenderProvider } from '../providers/types';
import { saveResultImage } from '../storage/resultStore';
import { serverLogger } from '../lib/logger';
import { RenderEngineOption, getRenderEngineOption } from '../config/renderEngines';
import { ActiveReservation, captureCredits, refundCredits, reserveCredits } from '../services/creditWallet';
import { requireAuth, AuthenticatedRequest } from '../middleware/requireAuth';
import { recordGeneration } from '../services/generationLog';
import {
  AspectRatioOption,
  CreateJobResponse,
  EnvironmentOption,
  JobStage,
  JobStatusResponse,
  LedOption,
  LightingOption,
  PreserveLevel,
  ProjectType,
  RenderSettings,
  RenderStyleOption,
} from '../types/api';

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
  result?: JobStatusResponse['result'];
  error?: JobStatusResponse['error'];
}

const jobs = new Map<string, Job>();

// Sweep abandoned jobs so the in-memory map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.startedAt > JOB_TTL_MS) jobs.delete(id);
  }
}, 5 * 60 * 1000).unref();

export const generateRouter = Router();

function parseSettings(body: Record<string, string>): RenderSettings {
  const required = [
    'projectType',
    'preserveArchitecture',
    'renderStyle',
    'lighting',
    'environment',
    'aspectRatio',
    'engine',
  ];
  for (const key of required) {
    if (!body[key]) {
      throw new AppError('VALIDATION_ERROR', `Missing required field: ${key}`, undefined, 400);
    }
  }

  return {
    projectType: body.projectType as ProjectType,
    preserveArchitecture: body.preserveArchitecture as PreserveLevel,
    renderStyle: body.renderStyle as RenderStyleOption,
    lighting: body.lighting as LightingOption,
    environment: body.environment as EnvironmentOption,
    // Optional/defaulted rather than required — added after this field list was
    // first introduced, so an older cached client bundle that never sends it
    // should still work instead of hard-failing the request.
    led: (body.led as LedOption) || 'automatic',
    aspectRatio: body.aspectRatio as AspectRatioOption,
    customInstructions: body.customInstructions?.trim() || undefined,
    // The client's `engine` value is only ever used to look up a RenderEngineOption
    // via getRenderEngineOption() below — the resulting provider/model/credits always
    // come from our own config, never from anything the client sends directly.
    engine: body.engine as RenderSettings['engine'],
  };
}

function validateImage(file: Express.Multer.File | undefined, label: string, required: boolean): 'image/png' | 'image/jpeg' | 'image/webp' | null {
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

generateRouter.post('/generate', requireAuth, uploadFields, async (req: Request, res: Response) => {
  let reservation: ActiveReservation | null = null;
  try {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const imageFile = files?.image?.[0];
    const referenceFile = files?.referenceImage?.[0];

    const imageMimeType = validateImage(imageFile, 'architectural model image', true);
    const referenceMimeType = validateImage(referenceFile, 'reference render image', false);

    const settings = parseSettings(req.body);

    const engineConfig = getRenderEngineOption(settings.engine);
    if (!engineConfig) {
      throw new AppError('VALIDATION_ERROR', `Unknown engine: ${settings.engine}`, undefined, 400);
    }


    const provider = getProvider(engineConfig.providerId);
    if (!provider || !provider.models.some((m) => m.id === engineConfig.modelId)) {
      // This can only happen from a config typo in config/renderEngines.ts, never from client input.
      serverLogger.error('Engine config references an unknown provider/model', engineConfig);
      throw new AppError('PROVIDER_UNAVAILABLE', 'This engine is temporarily unavailable.', undefined, 500);
    }

    const jobId = crypto.randomUUID();
    reservation = await reserveCredits({ userId: (req as AuthenticatedRequest).user!.id, amount: engineConfig.credits, tool: 'render', generationId: jobId });
    const job: Job = { id: jobId, stage: 'uploading', startedAt: Date.now() };
    jobs.set(jobId, job);

    const response: CreateJobResponse = { jobId, startedAt: job.startedAt };
    res.status(202).json(response);

    void runJob(job, reservation, provider, engineConfig, settings, {
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

generateRouter.get('/generate/:jobId', (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: { code: 'UNKNOWN_ERROR', message: 'Job not found. It may have expired.' } });
    return;
  }
  const payload: JobStatusResponse = {
    jobId: job.id,
    stage: job.stage,
    providerStatus: job.providerStatus,
    startedAt: job.startedAt,
    result: job.result,
    error: job.error,
  };
  res.json(payload);
});

function handleSyncError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    res.status(err.httpStatus).json({ error: err.toPayload() });
    return;
  }
  serverLogger.error('Unexpected error handling request', err);
  res.status(500).json({ error: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred.' } });
}

interface JobInput {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  referenceBuffer?: Buffer;
  referenceMimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
}

async function runJob(
  job: Job,
  reservation: ActiveReservation,
  provider: RenderProvider,
  engineConfig: RenderEngineOption,
  settings: RenderSettings,
  input: JobInput
): Promise<void> {
  const startedAt = job.startedAt;
  const hasReferenceRender = Boolean(input.referenceBuffer);
  try {
    job.stage = 'uploading';
    // Aspect ratio is always derived from the Architecture Model image (image 1),
    // never the optional Reference Render — the reference is aesthetics-only.
    const dims = sizeOf(input.buffer);
    if (!dims.width || !dims.height) {
      throw new AppError('IMAGE_UPLOAD_FAILED', 'Could not read the uploaded image dimensions.', undefined, 400);
    }
    const target = computeDimensionsForAspectRatio(dims.width, dims.height, settings.aspectRatio);

    const imageBase64 = input.buffer.toString('base64');
    const referenceImageBase64 = input.referenceBuffer?.toString('base64');
    const prompt = buildArchitecturalPrompt(settings, { hasReferenceRender });
    const outputFormat = input.mimeType === 'image/png' ? 'png' : 'jpeg';

    job.stage = 'sending';
    const result = await provider.generateRender(engineConfig.modelId, {
      prompt,
      imageBase64,
      referenceImageBase64,
      imageMimeType: input.mimeType,
      referenceImageMimeType: input.referenceMimeType,
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

    // Charge exactly once, only now that the generation has genuinely completed —
    // never before, never on a failure, never twice (this code path runs once per job).
    await captureCredits(reservation);

    job.result = {
      requestId: result.requestId,
      engine: engineConfig.id,
      provider: provider.id,
      model: engineConfig.modelId,
      imageUrl,
      prompt,
      generationTimeMs: Date.now() - startedAt,
      resolution,
      cost: { amount: null, currency: 'USD', isEstimate: false, note: 'Not provided by API' },
      status: 'Ready',
      creditsCharged: engineConfig.credits,
    };
    job.stage = 'complete';

    recordGeneration({
      generationId: job.id,
      timestamp: startedAt,
      engine: engineConfig.id,
      provider: provider.id,
      model: engineConfig.modelId,
      creditsCharged: engineConfig.credits,
      status: 'complete',
      resolution,
      hasReferenceRender,
    });
  } catch (err) {
    job.stage = 'error';
    await refundCredits(reservation, 'generation_failed');
    if (err instanceof AppError) {
      job.error = err.toPayload();
    } else {
      serverLogger.error(`Job ${job.id} failed unexpectedly`, err);
      job.error = {
        code: 'UNKNOWN_ERROR',
        message: 'An unexpected error occurred during generation.',
        details: err instanceof Error ? err.message : String(err),
      };
    }

    recordGeneration({
      generationId: job.id,
      timestamp: startedAt,
      engine: engineConfig.id,
      provider: provider.id,
      model: engineConfig.modelId,
      creditsCharged: 0,
      status: 'error',
      resolution: null,
      hasReferenceRender,
    });
  }
}
