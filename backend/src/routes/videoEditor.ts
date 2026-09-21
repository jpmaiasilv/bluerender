import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppError } from '../lib/errors';
import { detectAudioMimeType, detectImageMimeType, detectVideoMimeType } from '../lib/fileSignature';
import { saveUploadedMedia, sweepStaleUploads, UPLOADS_DIR } from '../storage/uploadStore';
import { saveResultVideo } from '../storage/resultStore';
import { probeFile, runExport, cleanupExportScratch } from '../lib/ffmpegExport';
import { serverLogger } from '../lib/logger';
import { JobErrorPayload, JobStage } from '../types/api';
import {
  EditorAudioItem,
  EditorClip,
  EditorExportProject,
  EditorExportResult,
  EditorFit,
  EditorFormat,
  EditorMediaRef,
  EditorMediaUploadResponse,
  EditorMotionIntensity,
  EditorMotionType,
  EditorMovementTimingMode,
  EditorResolution,
  EditorTransition,
  EditorTransitionType,
} from '../types/videoEditor';

const MAX_UPLOAD_SIZE = 250 * 1024 * 1024;
const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_CLIPS = 40;
const MAX_AUDIO_ITEMS = 10;
const MAX_TOTAL_DURATION_S = 600;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_SIZE } });

export const videoEditorRouter = Router();

setInterval(() => sweepStaleUploads(), 30 * 60 * 1000).unref();

// --- Media upload ---

const UPLOAD_KINDS = ['video', 'image', 'audio'] as const;
type UploadKind = (typeof UPLOAD_KINDS)[number];

videoEditorRouter.post('/video-editor/media', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    const kind = req.body?.kind as string | undefined;
    if (!file) {
      throw new AppError('MEDIA_UPLOAD_FAILED', 'No file was uploaded.', undefined, 400);
    }
    if (!kind || !UPLOAD_KINDS.includes(kind as UploadKind)) {
      throw new AppError('MEDIA_UPLOAD_FAILED', 'Missing or invalid media kind.', undefined, 400);
    }

    let mimeType: string | null = null;
    if (kind === 'image') mimeType = detectImageMimeType(file.buffer);
    else if (kind === 'video') mimeType = detectVideoMimeType(file.buffer);
    else mimeType = detectAudioMimeType(file.buffer);

    if (!mimeType) {
      throw new AppError(
        'MEDIA_UPLOAD_FAILED',
        `Unsupported ${kind} format.`,
        `Declared mimetype: ${file.mimetype}`,
        400
      );
    }

    const url = saveUploadedMedia(file.buffer, mimeType);

    let durationSeconds: number | null = null;
    if (kind === 'video' || kind === 'audio') {
      try {
        const filePath = path.join(UPLOADS_DIR, path.basename(url));
        const info = await probeFile(filePath);
        durationSeconds = info.durationSeconds || null;
      } catch {
        durationSeconds = null; // Non-fatal — the browser will read duration client-side from the media element.
      }
    }

    const payload: EditorMediaUploadResponse = { url, durationSeconds };
    res.json(payload);
  } catch (err) {
    handleSyncError(res, err);
  }
});

// --- Export ---

interface ExportJob {
  id: string;
  stage: JobStage;
  progress: number;
  startedAt: number;
  result?: EditorExportResult;
  error?: JobErrorPayload;
}

const jobs = new Map<string, ExportJob>();

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.startedAt > JOB_TTL_MS) jobs.delete(id);
  }
}, 5 * 60 * 1000).unref();

const FORMATS: EditorFormat[] = ['auto', 'reels', 'feed', 'youtube', 'square'];
const FITS: EditorFit[] = ['contain', 'cover'];
const RESOLUTIONS: EditorResolution[] = ['auto', '720', '1080'];
const TRANSITION_TYPES: EditorTransitionType[] = ['none', 'fade', 'dissolve', 'slide', 'zoom'];
const MOTION_TYPES: EditorMotionType[] = ['none', 'zoomIn', 'zoomOut', 'panLeft', 'panRight', 'panUp', 'panDown', 'kenBurns'];
const MOTION_INTENSITIES: EditorMotionIntensity[] = ['soft', 'medium'];
/** Generous but bounded — comfortably covers the 15s/30s/60s use cases this
 * was explicitly built for, without leaving the per-clip duration unbounded. */
const MAX_IMAGE_DURATION_S = 120;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  if (!isFiniteNumber(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

/** Every field here ends up interpolated into an ffmpeg filter string
 * (see ffmpegExport.ts) — every value is validated/clamped to a safe numeric
 * range or a whitelisted string here, before any of it is trusted. */
function parseMediaRef(value: unknown, label: string): EditorMediaRef {
  if (!value || typeof value !== 'object' || typeof (value as { url?: unknown }).url !== 'string') {
    throw new AppError('VALIDATION_ERROR', `Invalid ${label} source.`, undefined, 400);
  }
  const url = (value as { url: string }).url;
  if (!/^\/(results|uploads)\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(url)) {
    throw new AppError('VALIDATION_ERROR', `Invalid ${label} source URL.`, undefined, 400);
  }
  return { url };
}

function parseMotion(value: unknown): EditorMotionType {
  return MOTION_TYPES.includes(value as EditorMotionType) ? (value as EditorMotionType) : 'none';
}

function parseMotionIntensity(value: unknown): EditorMotionIntensity {
  return MOTION_INTENSITIES.includes(value as EditorMotionIntensity) ? (value as EditorMotionIntensity) : 'soft';
}

/** Clamps the custom movement window to stay inside the clip's own effective
 * duration: start >= 0, duration > 0, start + duration <= clip duration.
 * 'full' mode ignores start/duration entirely (see ffmpegExport.ts), but
 * they're still parsed/clamped here so the stored values are never invalid. */
function parseMovementWindow(
  obj: Record<string, unknown>,
  effectiveDuration: number
): { movementTimingMode: EditorMovementTimingMode; movementStart: number; movementDuration: number } {
  const movementTimingMode = obj.movementTimingMode === 'custom' ? 'custom' : 'full';
  const dur = Math.max(0.1, effectiveDuration);
  const movementStart = clampNum(obj.movementStart, 0, Math.max(0, dur - 0.1), 0);
  const movementDuration = clampNum(obj.movementDuration, 0.1, dur - movementStart, dur - movementStart);
  return { movementTimingMode, movementStart, movementDuration };
}

function parseClip(raw: unknown, index: number): EditorClip {
  if (!raw || typeof raw !== 'object') {
    throw new AppError('VALIDATION_ERROR', `Invalid clip at index ${index}.`, undefined, 400);
  }
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' && obj.id.length > 0 ? obj.id : crypto.randomUUID();

  if (obj.type === 'image') {
    const duration = clampNum(obj.duration, 0.5, MAX_IMAGE_DURATION_S, 3);
    return {
      id,
      type: 'image',
      source: parseMediaRef(obj.source, 'image clip'),
      duration,
      motion: parseMotion(obj.motion),
      motionIntensity: parseMotionIntensity(obj.motionIntensity),
      ...parseMovementWindow(obj, duration),
    };
  }
  if (obj.type === 'video') {
    const trimStart = clampNum(obj.trimStart, 0, 3600, 0);
    const trimEnd = Math.max(clampNum(obj.trimEnd, 0.1, 3600, trimStart + 1), trimStart + 0.1);
    const speed = clampNum(obj.speed, 0.5, 2, 1);
    const effectiveDuration = (trimEnd - trimStart) / speed;
    return {
      id,
      type: 'video',
      source: parseMediaRef(obj.source, 'video clip'),
      trimStart,
      trimEnd,
      speed,
      volume: clampNum(obj.volume, 0, 1, 1),
      motion: parseMotion(obj.motion),
      motionIntensity: parseMotionIntensity(obj.motionIntensity),
      ...parseMovementWindow(obj, effectiveDuration),
    };
  }
  throw new AppError('VALIDATION_ERROR', `Unknown clip type at index ${index}.`, undefined, 400);
}

function parseTransition(raw: unknown): EditorTransition | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.afterClipId !== 'string') return null;
  const type = TRANSITION_TYPES.includes(obj.type as EditorTransitionType) ? (obj.type as EditorTransitionType) : 'none';
  return {
    id: typeof obj.id === 'string' ? obj.id : crypto.randomUUID(),
    afterClipId: obj.afterClipId,
    type,
    duration: clampNum(obj.duration, 0, 3, 0.5),
  };
}

function parseAudioItem(raw: unknown): EditorAudioItem {
  if (!raw || typeof raw !== 'object') {
    throw new AppError('VALIDATION_ERROR', 'Invalid audio item.', undefined, 400);
  }
  const obj = raw as Record<string, unknown>;
  const trimStart = clampNum(obj.trimStart, 0, 3600, 0);
  const trimEnd = Math.max(clampNum(obj.trimEnd, 0.1, 3600, trimStart + 1), trimStart + 0.1);
  return {
    id: typeof obj.id === 'string' ? obj.id : crypto.randomUUID(),
    source: parseMediaRef(obj.source, 'audio'),
    trimStart,
    trimEnd,
    volume: clampNum(obj.volume, 0, 1, 1),
    fadeIn: clampNum(obj.fadeIn, 0, 10, 0),
    fadeOut: clampNum(obj.fadeOut, 0, 10, 0),
    startAt: clampNum(obj.startAt, 0, 3600, 0),
  };
}

function parseExportProject(body: unknown): EditorExportProject {
  if (!body || typeof body !== 'object') {
    throw new AppError('VALIDATION_ERROR', 'Missing project payload.', undefined, 400);
  }
  const outer = body as Record<string, unknown>;
  const project = outer.project;
  if (!project || typeof project !== 'object') {
    throw new AppError('VALIDATION_ERROR', 'Missing project payload.', undefined, 400);
  }
  const p = project as Record<string, unknown>;

  const format = FORMATS.includes(p.format as EditorFormat) ? (p.format as EditorFormat) : 'reels';
  const fit = FITS.includes(p.fit as EditorFit) ? (p.fit as EditorFit) : 'contain';
  const resolution = RESOLUTIONS.includes(p.resolution as EditorResolution) ? (p.resolution as EditorResolution) : '1080';

  if (!Array.isArray(p.clips) || p.clips.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'The project has no clips to export.', undefined, 400);
  }
  if (p.clips.length > MAX_CLIPS) {
    throw new AppError('VALIDATION_ERROR', `Too many clips (max ${MAX_CLIPS}).`, undefined, 400);
  }
  const clips = p.clips.map((c, i) => parseClip(c, i));

  const transitions = Array.isArray(p.transitions)
    ? p.transitions.map(parseTransition).filter((t): t is EditorTransition => t !== null)
    : [];

  const audioRaw = Array.isArray(p.audio) ? p.audio : [];
  if (audioRaw.length > MAX_AUDIO_ITEMS) {
    throw new AppError('VALIDATION_ERROR', `Too many audio items (max ${MAX_AUDIO_ITEMS}).`, undefined, 400);
  }
  const audio = audioRaw.map(parseAudioItem);

  const estimatedDuration = clips.reduce(
    (sum, c) => sum + (c.type === 'image' ? c.duration : (c.trimEnd - c.trimStart) / c.speed),
    0
  );
  if (estimatedDuration > MAX_TOTAL_DURATION_S) {
    throw new AppError('VALIDATION_ERROR', `Project is too long (max ${MAX_TOTAL_DURATION_S}s).`, undefined, 400);
  }

  return { format, fit, resolution, clips, transitions, audio };
}

videoEditorRouter.post('/video-editor/export', (req: Request, res: Response) => {
  try {
    const project = parseExportProject(req.body);

    const jobId = crypto.randomUUID();
    const job: ExportJob = { id: jobId, stage: 'uploading', progress: 0, startedAt: Date.now() };
    jobs.set(jobId, job);

    res.status(202).json({ jobId, startedAt: job.startedAt });

    void runExportJob(job, project);
  } catch (err) {
    handleSyncError(res, err);
  }
});

videoEditorRouter.get('/video-editor/export/:jobId', (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: { code: 'UNKNOWN_ERROR', message: 'Export job not found. It may have expired.' } });
    return;
  }
  res.json({
    jobId: job.id,
    stage: job.stage,
    progress: job.progress,
    startedAt: job.startedAt,
    result: job.result,
    error: job.error,
  });
});

async function runExportJob(job: ExportJob, project: EditorExportProject): Promise<void> {
  const startedAt = job.startedAt;
  try {
    job.stage = 'rendering';
    const outcome = await runExport(project, job.id, (percent) => {
      job.progress = percent;
    });

    job.stage = 'downloading';
    const buffer = fs.readFileSync(outcome.outputPath);
    const videoUrl = saveResultVideo(job.id, buffer, 'video/mp4');

    job.result = {
      videoUrl,
      durationSeconds: outcome.durationSeconds,
      generationTimeMs: Date.now() - startedAt,
    };
    job.progress = 100;
    job.stage = 'complete';
  } catch (err) {
    job.stage = 'error';
    if (err instanceof AppError) {
      job.error = err.toPayload();
    } else {
      serverLogger.error(`Video editor export job ${job.id} failed unexpectedly`, err);
      job.error = {
        code: 'EXPORT_FAILED',
        message: 'An unexpected error occurred while exporting the video.',
        details: err instanceof Error ? err.message : String(err),
      };
    }
  } finally {
    cleanupExportScratch(job.id);
  }
}

function handleSyncError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    res.status(err.httpStatus).json({ error: err.toPayload() });
    return;
  }
  serverLogger.error('Unexpected error handling video editor request', err);
  res.status(500).json({ error: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred.' } });
}
