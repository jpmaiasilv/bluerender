import { Router, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import sizeOf from 'image-size';
import { AppError } from '../lib/errors';
import { buildTextToImagePrompt } from '../lib/textToImagePromptBuilder';
import { computeDimensionsForTextToImage } from '../lib/imageDimensions';
import { detectImageMimeType } from '../lib/fileSignature';
import { getProvider } from '../providers/registry';
import { RenderProvider } from '../providers/types';
import { saveResultImage } from '../storage/resultStore';
import { serverLogger } from '../lib/logger';
import { getT2IEngineOption, listT2IEngineOptions, T2IEngineOption } from '../config/textToImageEngines';
import { ActiveReservation, captureCredits, refundCredits, reserveCredits } from '../services/creditWallet';
import { requireAuth, AuthenticatedRequest } from '../middleware/requireAuth';
import { recordGeneration } from '../services/generationLog';
import {
  T2IAspectRatio,
  T2ICreateJobResponse,
  T2ICreativity,
  T2IGeneratedImage,
  T2IImageCount,
  T2IJobStatusResponse,
  T2ILighting,
  T2IProjectType,
  T2IStyle,
  TextToImageSettings,
} from '../types/textToImage';
import { EnvironmentOption, JobStage, LedOption } from '../types/api';

// No API limit was found for prompt length in BFL's docs, so a sensible cap is
// used instead of allowing unbounded input (never silently truncated — rejected
// with a clear validation error instead).
const MAX_PROMPT_LENGTH = 4000;
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
const JOB_TTL_MS = 30 * 60 * 1000;
const VALID_COUNTS: T2IImageCount[] = [1, 2, 4];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

const uploadFields = upload.fields([{ name: 'referenceImage', maxCount: 1 }]);

interface Job {
  id: string;
  stage: JobStage;
  startedAt: number;
  result?: T2IJobStatusResponse['result'];
  error?: T2IJobStatusResponse['error'];
}

const jobs = new Map<string, Job>();

// Sweep abandoned jobs so the in-memory map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.startedAt > JOB_TTL_MS) jobs.delete(id);
  }
}, 5 * 60 * 1000).unref();

export const textToImageRouter = Router();

textToImageRouter.get('/text-to-image/engines', (_req: Request, res: Response) => {
  res.json({ engines: listT2IEngineOptions() });
});

function parseSettings(body: Record<string, string>): TextToImageSettings {
  const prompt = body.prompt?.trim();
  if (!prompt) {
    throw new AppError('VALIDATION_ERROR', 'Prompt cannot be empty.', undefined, 400);
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Prompt exceeds the ${MAX_PROMPT_LENGTH}-character limit.`,
      `length=${prompt.length}`,
      400
    );
  }

  const required = ['engine', 'aspectRatio', 'style', 'projectType', 'lighting', 'creativity', 'count'];
  for (const key of required) {
    if (!body[key]) {
      throw new AppError('VALIDATION_ERROR', `Missing required field: ${key}`, undefined, 400);
    }
  }

  const count = Number(body.count) as T2IImageCount;
  if (!VALID_COUNTS.includes(count)) {
    throw new AppError('VALIDATION_ERROR', `Invalid image count: ${body.count}`, undefined, 400);
  }

  return {
    prompt,
    engine: body.engine as TextToImageSettings['engine'],
    count,
    aspectRatio: body.aspectRatio as T2IAspectRatio,
    style: body.style as T2IStyle,
    projectType: body.projectType as T2IProjectType,
    lighting: body.lighting as T2ILighting,
    // Optional/defaulted rather than required — added after this field list was
    // first introduced, so an older cached client bundle that never sends them
    // should still work instead of hard-failing the request.
    environment: (body.environment as EnvironmentOption) || 'preserve_original',
    led: (body.led as LedOption) || 'automatic',
    creativity: body.creativity as T2ICreativity,
  };
}

textToImageRouter.post('/text-to-image/generate', requireAuth, uploadFields, async (req: Request, res: Response) => {
  let reservation: ActiveReservation | null = null;
  try {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const referenceFile = files?.referenceImage?.[0];

    let referenceMimeType: 'image/png' | 'image/jpeg' | 'image/webp' | null = null;
    if (referenceFile) {
      referenceMimeType = detectImageMimeType(referenceFile.buffer);
      if (!referenceMimeType) {
        throw new AppError(
          'IMAGE_UPLOAD_FAILED',
          'Unsupported reference image format. Please upload a JPG, PNG or WEBP file.',
          `Declared mimetype: ${referenceFile.mimetype}`,
          400
        );
      }
    }

    const settings = parseSettings(req.body);

    const engineOption = getT2IEngineOption(settings.engine);
    if (!engineOption) {
      throw new AppError('VALIDATION_ERROR', `Unknown engine: ${settings.engine}`, undefined, 400);
    }

    // Billing gate: check the FULL multi-image cost BEFORE calling the provider at
    // all, mirroring routes/generate.ts — an insufficient balance never even
    // reaches BFL, and never wastes a partial paid call.
    const totalCost = engineOption.credits * settings.count;

    const provider = getProvider(engineOption.providerId);
    if (!provider || !provider.models.some((m) => m.id === engineOption.modelId)) {
      // Can only happen from a config typo in config/textToImageEngines.ts, never from client input.
      serverLogger.error('T2I engine config references an unknown provider/model', engineOption);
      throw new AppError('PROVIDER_UNAVAILABLE', 'This engine is temporarily unavailable.', undefined, 500);
    }

    const jobId = crypto.randomUUID();
    reservation = await reserveCredits({ userId: (req as AuthenticatedRequest).user!.id, amount: totalCost, tool: 'text_to_image', generationId: jobId });
    const job: Job = { id: jobId, stage: 'uploading', startedAt: Date.now() };
    jobs.set(jobId, job);

    const response: T2ICreateJobResponse = { jobId, startedAt: job.startedAt };
    res.status(202).json(response);

    void runJob(job, reservation, provider, engineOption, settings, {
      referenceBuffer: referenceFile?.buffer,
      referenceMimeType: referenceMimeType ?? undefined,
    });
  } catch (err) {
    if (reservation) await refundCredits(reservation, 'request_failed');
    handleSyncError(res, err);
  }
});

textToImageRouter.get('/text-to-image/generate/:jobId', (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: { code: 'UNKNOWN_ERROR', message: 'Job not found. It may have expired.' } });
    return;
  }
  const payload: T2IJobStatusResponse = {
    jobId: job.id,
    stage: job.stage,
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
  serverLogger.error('Unexpected error handling text-to-image request', err);
  res.status(500).json({ error: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred.' } });
}

interface JobInput {
  referenceBuffer?: Buffer;
  referenceMimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
}

async function runJob(
  job: Job,
  reservation: ActiveReservation,
  provider: RenderProvider,
  engineOption: T2IEngineOption,
  settings: TextToImageSettings,
  input: JobInput
): Promise<void> {
  const startedAt = job.startedAt;
  const hasReferenceImage = Boolean(input.referenceBuffer);

  try {
    job.stage = 'uploading';
    const target = computeDimensionsForTextToImage(settings.aspectRatio);
    const referenceImageBase64 = input.referenceBuffer?.toString('base64');
    const prompt = buildTextToImagePrompt(settings, { hasReferenceImage });
    const outputFormat: 'png' | 'jpeg' = input.referenceMimeType === 'image/png' ? 'png' : 'jpeg';

    job.stage = 'sending';

    // BFL has no native "N images per request" parameter, so N images means N
    // independent parallel calls. allSettled means one failed attempt among
    // several never fails the whole job — a partial result (e.g. 3 of 4) is
    // still returned and only the images that actually succeeded are charged.
    const attempts = await Promise.allSettled(
      Array.from({ length: settings.count }, () =>
        provider.generateRender(engineOption.modelId, {
          prompt,
          referenceImageBase64,
          referenceImageMimeType: input.referenceMimeType,
          width: target?.width,
          height: target?.height,
          outputFormat,
          onProviderStatus: () => {
            job.stage = 'rendering';
          },
        })
      )
    );

    job.stage = 'downloading';

    const images: T2IGeneratedImage[] = [];
    let firstError: AppError | null = null;

    for (const attempt of attempts) {
      if (attempt.status === 'fulfilled') {
        const result = attempt.value;
        const dims = sizeOf(result.imageBuffer);
        const imageUrl = saveResultImage(result.requestId, result.imageBuffer, result.contentType);
        images.push({
          requestId: result.requestId,
          imageUrl,
          resolution: dims.width && dims.height ? { width: dims.width, height: dims.height } : null,
        });
      } else if (!firstError) {
        firstError =
          attempt.reason instanceof AppError
            ? attempt.reason
            : new AppError('UNKNOWN_ERROR', 'Generation failed.', String(attempt.reason));
      }
    }

    if (images.length === 0) {
      throw firstError ?? new AppError('GENERATION_FAILED', 'The generation failed.', undefined, 502);
    }

    // Charge exactly once, only for the images that genuinely completed — never
    // before, never for failed attempts, never twice (this code path runs once per job).
    const creditsCharged = engineOption.credits * images.length;
    await captureCredits(reservation, creditsCharged);

    job.result = {
      engine: engineOption.id,
      provider: provider.id,
      model: engineOption.modelId,
      prompt,
      images,
      requestedCount: settings.count,
      generationTimeMs: Date.now() - startedAt,
      creditsCharged,
      status: images.length === settings.count ? 'Ready' : 'Partial',
    };
    job.stage = 'complete';

    recordGeneration({
      generationId: job.id,
      timestamp: startedAt,
      engine: engineOption.id,
      provider: provider.id,
      model: engineOption.modelId,
      creditsCharged,
      status: 'complete',
      resolution: images[0]?.resolution ?? null,
      hasReferenceRender: hasReferenceImage,
    });
  } catch (err) {
    job.stage = 'error';
    await refundCredits(reservation, 'generation_failed');
    if (err instanceof AppError) {
      job.error = err.toPayload();
    } else {
      serverLogger.error(`T2I job ${job.id} failed unexpectedly`, err);
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
