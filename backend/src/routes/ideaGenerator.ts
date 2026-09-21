import { Router, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import sizeOf from 'image-size';
import { AppError } from '../lib/errors';
import { buildIdeaPrompt } from '../lib/ideaGeneratorPromptBuilder';
import { computeTargetDimensions } from '../lib/imageDimensions';
import { detectImageMimeType } from '../lib/fileSignature';
import { getProvider } from '../providers/registry';
import { RenderProvider } from '../providers/types';
import { saveResultImage } from '../storage/resultStore';
import { serverLogger } from '../lib/logger';
import { getIdeaEngineOption, IdeaEngineOption, IdeaGenerationMode, listIdeaEngineOptions } from '../config/ideaGeneratorEngines';
import { ActiveReservation, captureCredits, refundCredits, reserveCredits } from '../services/creditWallet';
import { requireAuth, AuthenticatedRequest } from '../middleware/requireAuth';
import { recordGeneration } from '../services/generationLog';
import {
  IdeaAtmosphere,
  IdeaCamera,
  IdeaCreativity,
  IdeaEnvironment,
  IdeaGeneratedImage,
  IdeaGeneratorSettings,
  IdeaGoal,
  IdeaImageCount,
  IdeaJobStatusResponse,
  IdeaLighting,
  IdeaMaterialPreset,
  IdeaStyle,
  PreservationLevel,
  TransformationLevel,
} from '../types/ideaGenerator';
import { EnvironmentOption, JobStage, LedOption } from '../types/api';

const MAX_SPACE_LENGTH = 120;
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const JOB_TTL_MS = 30 * 60 * 1000;
const VALID_COUNTS: IdeaImageCount[] = [1, 2, 4];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } });
const uploadFields = upload.fields([{ name: 'referenceImage', maxCount: 1 }]);

interface Job {
  id: string;
  stage: JobStage;
  startedAt: number;
  result?: IdeaJobStatusResponse['result'];
  error?: IdeaJobStatusResponse['error'];
}

const jobs = new Map<string, Job>();

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.startedAt > JOB_TTL_MS) jobs.delete(id);
  }
}, 5 * 60 * 1000).unref();

export const ideaGeneratorRouter = Router();

ideaGeneratorRouter.get('/idea-generator/engines', (req: Request, res: Response) => {
  const mode: IdeaGenerationMode = req.query.mode === 'imageToImage' ? 'imageToImage' : 'textToImage';
  res.json({ engines: listIdeaEngineOptions(mode) });
});

function parseSettings(body: Record<string, string>): IdeaGeneratorSettings {
  const required = [
    'environment',
    'space',
    'goal',
    'style',
    'engine',
    'count',
    'preservation',
    'transformation',
    'lighting',
    'camera',
    'atmosphere',
    'materials',
    'creativity',
  ];
  for (const key of required) {
    if (!body[key]) {
      throw new AppError('VALIDATION_ERROR', `Missing required field: ${key}`, undefined, 400);
    }
  }

  const space = body.space.trim();
  if (!space) {
    throw new AppError('VALIDATION_ERROR', 'Space cannot be empty.', undefined, 400);
  }
  if (space.length > MAX_SPACE_LENGTH) {
    throw new AppError('VALIDATION_ERROR', `Space exceeds the ${MAX_SPACE_LENGTH}-character limit.`, undefined, 400);
  }

  const details = body.details?.trim();

  const count = Number(body.count) as IdeaImageCount;
  if (!VALID_COUNTS.includes(count)) {
    throw new AppError('VALIDATION_ERROR', `Invalid image count: ${body.count}`, undefined, 400);
  }

  return {
    environment: body.environment as IdeaEnvironment,
    space,
    goal: body.goal as IdeaGoal,
    style: body.style as IdeaStyle,
    details: details || undefined,
    engine: body.engine as IdeaGeneratorSettings['engine'],
    count,
    preservation: body.preservation as PreservationLevel,
    transformation: body.transformation as TransformationLevel,
    lighting: body.lighting as IdeaLighting,
    camera: body.camera as IdeaCamera,
    atmosphere: body.atmosphere as IdeaAtmosphere,
    materials: body.materials as IdeaMaterialPreset,
    // Optional/defaulted rather than required — added after this field list was
    // first introduced, so an older cached client bundle that never sends them
    // should still work instead of hard-failing the request.
    surroundings: (body.surroundings as EnvironmentOption) || 'preserve_original',
    led: (body.led as LedOption) || 'automatic',
    creativity: body.creativity as IdeaCreativity,
  };
}

ideaGeneratorRouter.post('/idea-generator/generate', requireAuth, uploadFields, async (req: Request, res: Response) => {
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
    // The mode is derived from whether an image was actually uploaded — never
    // trusted from a client-sent field — so a request can't claim "textToImage"
    // pricing while attaching an image, or vice versa.
    const mode: IdeaGenerationMode = referenceFile ? 'imageToImage' : 'textToImage';

    const engineOption = getIdeaEngineOption(mode, settings.engine);
    if (!engineOption) {
      throw new AppError('VALIDATION_ERROR', `Unknown engine: ${settings.engine}`, undefined, 400);
    }

    const totalCost = engineOption.credits * settings.count;

    const provider = getProvider(engineOption.providerId);
    if (!provider || !provider.models.some((m) => m.id === engineOption.modelId)) {
      serverLogger.error('Idea Generator engine config references an unknown provider/model', engineOption);
      throw new AppError('PROVIDER_UNAVAILABLE', 'This engine is temporarily unavailable.', undefined, 500);
    }

    const jobId = crypto.randomUUID();
    reservation = await reserveCredits({ userId: (req as AuthenticatedRequest).user!.id, amount: totalCost, tool: 'idea_generator', generationId: jobId });
    const job: Job = { id: jobId, stage: 'uploading', startedAt: Date.now() };
    jobs.set(jobId, job);

    res.status(202).json({ jobId, startedAt: job.startedAt });

    void runJob(job, reservation, provider, engineOption, mode, settings, {
      referenceBuffer: referenceFile?.buffer,
      referenceMimeType: referenceMimeType ?? undefined,
    });
  } catch (err) {
    if (reservation) await refundCredits(reservation, 'request_failed');
    handleSyncError(res, err);
  }
});

ideaGeneratorRouter.get('/idea-generator/generate/:jobId', (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: { code: 'UNKNOWN_ERROR', message: 'Job not found. It may have expired.' } });
    return;
  }
  const payload: IdeaJobStatusResponse = {
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
  serverLogger.error('Unexpected error handling idea generator request', err);
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
  engineOption: IdeaEngineOption,
  mode: IdeaGenerationMode,
  settings: IdeaGeneratorSettings,
  input: JobInput
): Promise<void> {
  const startedAt = job.startedAt;
  const hasReferenceImage = Boolean(input.referenceBuffer);

  try {
    job.stage = 'uploading';

    let target: { width: number; height: number } | null = null;
    if (input.referenceBuffer) {
      const dims = sizeOf(input.referenceBuffer);
      if (!dims.width || !dims.height) {
        throw new AppError('IMAGE_UPLOAD_FAILED', 'Could not read the uploaded image dimensions.', undefined, 400);
      }
      target = computeTargetDimensions(dims.width, dims.height);
    }

    const imageBase64 = input.referenceBuffer?.toString('base64');
    const prompt = buildIdeaPrompt(settings, { hasReferenceImage });
    const outputFormat: 'png' | 'jpeg' = input.referenceMimeType === 'image/png' ? 'png' : 'jpeg';

    job.stage = 'sending';

    const attempts = await Promise.allSettled(
      Array.from({ length: settings.count }, () =>
        provider.generateRender(engineOption.modelId, {
          prompt,
          imageBase64,
          imageMimeType: input.referenceMimeType,
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

    const images: IdeaGeneratedImage[] = [];
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

    const creditsCharged = engineOption.credits * images.length;
    await captureCredits(reservation, creditsCharged);

    job.result = {
      mode,
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
      serverLogger.error(`Idea Generator job ${job.id} failed unexpectedly`, err);
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
