import { Router, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { AppError } from '../lib/errors';
import { buildVideoPrompt } from '../lib/videoPromptBuilder';
import { detectImageMimeType } from '../lib/fileSignature';
import { generateVideo, GeminiVideoModel, GeminiVideoResolution } from '../providers/geminiVideo';
import { saveResultVideo } from '../storage/resultStore';
import { serverLogger, videoLogger } from '../lib/logger';
import { computeVideoCost, isVideoDuration, VideoDuration, VIDEO_DURATION_OPTIONS, VIDEO_MODEL_ID, VIDEO_PROVIDER_ID } from '../config/videoEngines';
import { ActiveReservation, captureCredits, refundCredits, reserveCredits } from '../services/creditWallet';
import { requireAuth, AuthenticatedRequest } from '../middleware/requireAuth';
import { recordGeneration } from '../services/generationLog';
import { VideoGeneratorSettings, VideoJobStatusResponse, VideoPricingResponse } from '../types/videoGenerator';
import { JobErrorPayload, JobStage } from '../types/api';

const MAX_PROMPT_LENGTH = 2000;
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const JOB_TTL_MS = 30 * 60 * 1000;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } });
const uploadFields = upload.fields([
  { name: 'sourceImage', maxCount: 1 },
  // Optional — pins the video's final frame (Veo 3.1 only; rejected request
  // as last-frame-only without a starting image, enforced below). Real API
  // capability, not prompt-engineering: confirmed via Google's official docs
  // (see providers/geminiVideo.ts's GeminiVideoGenerateParams.lastFrameBase64).
  { name: 'endImage', maxCount: 1 },
]);

interface Job {
  id: string;
  stage: JobStage;
  startedAt: number;
  result?: VideoJobStatusResponse['result'];
  error?: VideoJobStatusResponse['error'];
}

const jobs = new Map<string, Job>();

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.startedAt > JOB_TTL_MS) jobs.delete(id);
  }
}, 5 * 60 * 1000).unref();

export const videoGeneratorRouter = Router();

videoGeneratorRouter.get('/video-generator/pricing', (_req: Request, res: Response) => {
  const creditsByDuration = Object.fromEntries(VIDEO_DURATION_OPTIONS.map((d) => [d, computeVideoCost(d)])) as Record<
    VideoDuration,
    number
  >;
  const payload: VideoPricingResponse = { durations: VIDEO_DURATION_OPTIONS, creditsByDuration };
  res.json(payload);
});

/**
 * `allowAnyDuration` widens the accepted range from the product's fixed
 * 4/6/8s choices — used only for the backend-side model/resolution
 * comparison tests (see parseModelOverride below), never reachable from the
 * actual UI. The resulting `durationSeconds` is cast to `VideoDuration` for
 * that test path even though it may not literally be one of 4/6/8 — safe
 * because this value only flows into logging/cost math, never back out
 * through the frontend-facing VideoDuration contract.
 */
function parseSettings(body: Record<string, string>, allowAnyDuration = false): VideoGeneratorSettings {
  const prompt = body.prompt?.trim();
  if (!prompt) {
    throw new AppError('VALIDATION_ERROR', 'Prompt cannot be empty.', undefined, 400);
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new AppError('VALIDATION_ERROR', `Prompt exceeds the ${MAX_PROMPT_LENGTH}-character limit.`, undefined, 400);
  }

  const durationSeconds = Number(body.durationSeconds);
  if (allowAnyDuration) {
    if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 8) {
      throw new AppError('VALIDATION_ERROR', `Invalid duration: ${body.durationSeconds}`, undefined, 400);
    }
    return { prompt, durationSeconds: durationSeconds as VideoGeneratorSettings['durationSeconds'] };
  }

  if (!isVideoDuration(durationSeconds)) {
    throw new AppError('VALIDATION_ERROR', `Invalid duration: ${body.durationSeconds}`, undefined, 400);
  }

  return { prompt, durationSeconds };
}

const KNOWN_MODELS: GeminiVideoModel[] = ['veo-3.1-lite-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-generate-preview'];
const KNOWN_RESOLUTIONS: GeminiVideoResolution[] = ['720p', '1080p'];

/**
 * Not part of the stable, frontend-facing contract — the app always sends
 * "veo-3.1-lite-generate-preview" / no explicit resolution (backend default
 * 720p) today. These optional overrides exist purely so we can A/B the Veo
 * tiers' cost/quality server-side (e.g. via curl) before ever considering a
 * quality upgrade, without touching VideoGeneratorSettings or the UI.
 */
function parseModelOverride(body: Record<string, string>): { model?: GeminiVideoModel; resolution?: GeminiVideoResolution } {
  const model = body.model && KNOWN_MODELS.includes(body.model as GeminiVideoModel) ? (body.model as GeminiVideoModel) : undefined;
  const resolution =
    body.resolution && KNOWN_RESOLUTIONS.includes(body.resolution as GeminiVideoResolution)
      ? (body.resolution as GeminiVideoResolution)
      : undefined;
  return { model, resolution };
}

videoGeneratorRouter.post('/video-generator/generate', requireAuth, uploadFields, async (req: Request, res: Response) => {
  let reservation: ActiveReservation | null = null;
  try {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const sourceFile = files?.sourceImage?.[0];
    const endFile = files?.endImage?.[0];

    let sourceMimeType: string | null = null;
    if (sourceFile) {
      sourceMimeType = detectImageMimeType(sourceFile.buffer);
      if (!sourceMimeType) {
        throw new AppError(
          'IMAGE_UPLOAD_FAILED',
          'Unsupported source image format. Please upload a JPG, PNG or WEBP file.',
          `Declared mimetype: ${sourceFile.mimetype}`,
          400
        );
      }
    }

    let endMimeType: string | null = null;
    if (endFile) {
      if (!sourceFile) {
        throw new AppError('VALIDATION_ERROR', 'A final-frame image requires a starting image too.', undefined, 400);
      }
      endMimeType = detectImageMimeType(endFile.buffer);
      if (!endMimeType) {
        throw new AppError(
          'IMAGE_UPLOAD_FAILED',
          'Unsupported final-frame image format. Please upload a JPG, PNG or WEBP file.',
          `Declared mimetype: ${endFile.mimetype}`,
          400
        );
      }
    }

    const override = parseModelOverride(req.body);
    const settings = parseSettings(req.body, Boolean(override.model));

    const totalCost = computeVideoCost(settings.durationSeconds);

    const jobId = crypto.randomUUID();
    reservation = await reserveCredits({ userId: (req as AuthenticatedRequest).user!.id, amount: totalCost, tool: 'video_generator', generationId: jobId });
    const job: Job = { id: jobId, stage: 'uploading', startedAt: Date.now() };
    jobs.set(jobId, job);

    res.status(202).json({ jobId, startedAt: job.startedAt });

    void runJob(job, reservation, settings, totalCost, {
      sourceBuffer: sourceFile?.buffer,
      sourceMimeType: sourceMimeType ?? undefined,
      endBuffer: endFile?.buffer,
      endMimeType: endMimeType ?? undefined,
      model: override.model,
      resolution: override.resolution,
    });
  } catch (err) {
    if (reservation) await refundCredits(reservation, 'request_failed');
    handleSyncError(res, err);
  }
});

videoGeneratorRouter.get('/video-generator/generate/:jobId', (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: { code: 'UNKNOWN_ERROR', message: 'Job not found. It may have expired.' } });
    return;
  }
  const payload: VideoJobStatusResponse = {
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
  serverLogger.error('Unexpected error handling video generator request', err);
  res.status(500).json({ error: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred.' } });
}

interface JobInput {
  sourceBuffer?: Buffer;
  sourceMimeType?: string;
  /** Optional final-frame image — real Veo 3.1 "First & Last Frame" interpolation, not simulated. */
  endBuffer?: Buffer;
  endMimeType?: string;
  model?: GeminiVideoModel;
  resolution?: GeminiVideoResolution;
}

/**
 * Turns whatever was thrown into the payload stored on the job — exported
 * (well, kept as a standalone pure function) so it can be unit-tested with
 * every shape a failure can take: an AppError from the Gemini/Veo provider,
 * a plain Error, and a non-Error thrown value. This is deliberately the
 * FIRST thing runJob's catch block calls, before anything that could itself
 * fail (like the refund below) gets a chance to run.
 */
export function buildJobErrorPayload(err: unknown): JobErrorPayload {
  if (err instanceof AppError) return err.toPayload();
  return {
    code: 'UNKNOWN_ERROR',
    message: 'An unexpected error occurred during generation.',
    details: err instanceof Error ? err.message : String(err),
  };
}

type RefundOutcome = 'refunded' | 'pending_reconciliation' | 'threw';

/**
 * Refund attempted in complete isolation from error capture above: whatever
 * happens here — success, a no-op because it was already settled, or an
 * unexpected throw — can never overwrite or hide the original generation
 * error already stored on the job. refundCredits() itself is designed to
 * never throw (an unrecorded refund is logged and picked up later by the
 * wallet reconciler, so the reservation is never lost and a retry stays
 * safe — calling refundCredits again for the same reservation is a no-op
 * once it's actually settled) — this still wraps it in try/catch as a second
 * line of defense in case that contract ever changes.
 */
export async function attemptRefund(jobId: string, reservation: ActiveReservation): Promise<RefundOutcome> {
  try {
    const refund = await refundCredits(reservation, 'generation_failed');
    if (refund) {
      videoLogger.log(`job=${jobId} refund=confirmed amount=${refund.refunded} refundId=${refund.refundId}`);
      return 'refunded';
    }
    videoLogger.log(`job=${jobId} refund=pending — not yet confirmed, the wallet reconciler will retry it; reservation is not lost`);
    return 'pending_reconciliation';
  } catch (refundErr) {
    videoLogger.error(
      `[VIDEO IA ERROR] job=${jobId} refund attempt threw unexpectedly — the original generation error was already saved and is not affected`,
      refundErr instanceof Error ? refundErr.message : String(refundErr)
    );
    return 'threw';
  }
}

async function runJob(
  job: Job,
  reservation: ActiveReservation, settings: VideoGeneratorSettings, totalCost: number, input: JobInput): Promise<void> {
  const startedAt = job.startedAt;
  const hasSourceImage = Boolean(input.sourceBuffer);
  const hasEndImage = Boolean(input.endBuffer);

  try {
    job.stage = 'uploading';
    const prompt = buildVideoPrompt(settings, { hasSourceImage, hasEndImage });

    job.stage = 'sending';
    videoLogger.log(
      `job=${job.id} requesting model=${input.model || VIDEO_MODEL_ID} duration=${settings.durationSeconds}s resolution=${input.resolution || '720p'} hasSourceImage=${hasSourceImage} hasEndImage=${hasEndImage}`
    );
    const result = await generateVideo({
      prompt,
      imageBase64: input.sourceBuffer?.toString('base64'),
      imageMimeType: input.sourceMimeType,
      lastFrameBase64: input.endBuffer?.toString('base64'),
      lastFrameMimeType: input.endMimeType,
      durationSeconds: settings.durationSeconds,
      model: input.model,
      resolution: input.resolution,
      onProviderStatus: () => {
        job.stage = 'rendering';
      },
    });

    job.stage = 'downloading';
    const videoUrl = saveResultVideo(result.requestId, result.videoBuffer, result.contentType);

    // Charge exactly once, only now that the generation has genuinely
    // completed — never before, never on failure, never twice.
    await captureCredits(reservation);

    job.result = {
      provider: VIDEO_PROVIDER_ID,
      model: input.model || VIDEO_MODEL_ID,
      prompt,
      videoUrl,
      requestId: result.requestId,
      durationSeconds: result.durationSeconds,
      generationTimeMs: Date.now() - startedAt,
      creditsCharged: totalCost,
      status: 'Ready',
    };
    job.stage = 'complete';

    if (result.costUsd !== null) {
      serverLogger.log(`Video generation real cost: $${result.costUsd.toFixed(4)} (Gemini request ${result.requestId})`);
    }

    recordGeneration({
      generationId: job.id,
      timestamp: startedAt,
      engine: `video-${settings.durationSeconds}s`,
      provider: VIDEO_PROVIDER_ID,
      model: input.model || VIDEO_MODEL_ID,
      creditsCharged: totalCost,
      status: 'complete',
      resolution: null,
      hasReferenceRender: hasSourceImage,
    });
  } catch (err) {
    job.stage = 'error';

    // Capture and store the ORIGINAL error FIRST, before anything else runs —
    // the refund attempt below must never get a chance to overwrite or hide it.
    const errorPayload = buildJobErrorPayload(err);
    job.error = errorPayload;
    videoLogger.error(
      `[VIDEO IA ERROR] job=${job.id} code=${errorPayload.code} message=${errorPayload.message}${errorPayload.details ? ` details=${errorPayload.details}` : ''}`
    );

    await attemptRefund(job.id, reservation);

    recordGeneration({
      generationId: job.id,
      timestamp: startedAt,
      engine: `video-${settings.durationSeconds}s`,
      provider: VIDEO_PROVIDER_ID,
      model: input.model || VIDEO_MODEL_ID,
      creditsCharged: 0,
      status: 'error',
      resolution: null,
      hasReferenceRender: hasSourceImage,
    });
  }
}
