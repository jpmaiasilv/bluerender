import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sizeOf from 'image-size';
import { ffmpeg } from './ffmpegBinaries';
import { AppError } from './errors';
import { resolvePublicMediaPath } from '../storage/mediaPath';
import { computeCanvasDimensions } from './canvasDimensions';
import { buildMotionFilterStage } from './motionFilter';
import { EditorExportProject, EditorFit, EditorTransitionType } from '../types/videoEditor';

const FPS = 30;
// Deliberately NOT under the project directory: this repo lives on a
// Google Drive–synced mount, whose virtual filesystem makes ffmpeg's
// frame-by-frame read/write pattern extremely slow (observed: minutes for a
// few seconds of output). Encoding happens entirely on local disk — source
// files are copied in, the result is copied out as a single bulk write.
const SCRATCH_ROOT = path.join(os.tmpdir(), 'blue-render-video-editor-export');

const XFADE_MAP: Record<Exclude<EditorTransitionType, 'none'>, string> = {
  fade: 'fade',
  dissolve: 'dissolve',
  slide: 'slideleft',
  zoom: 'zoomin',
};

/** Fixed-decimal formatting for every number interpolated into a filter string
 * — never exponential notation, never attacker-influenced length/shape. Every
 * numeric field on the project is already range-validated by the route before
 * reaching here; this is the second, defense-in-depth layer right at the
 * string-building boundary. */
function num(n: number, decimals = 3): string {
  const clamped = Number.isFinite(n) ? n : 0;
  return clamped.toFixed(decimals);
}

interface ProbeInfo {
  durationSeconds: number;
  hasAudio: boolean;
  width?: number;
  height?: number;
}

export function probeFile(filePath: string): Promise<ProbeInfo> {
  return probe(filePath);
}

function probe(filePath: string): Promise<ProbeInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      const duration = data.format?.duration ?? 0;
      const streams = data.streams ?? [];
      const hasAudio = streams.some((s) => s.codec_type === 'audio');
      const videoStream = streams.find((s) => s.codec_type === 'video');
      resolve({ durationSeconds: duration, hasAudio, width: videoStream?.width, height: videoStream?.height });
    });
  });
}

function parseTimemark(timemark: string): number {
  const match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(timemark);
  if (!match) return 0;
  const [, h, m, s] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/** 'contain' ("Ajustar"): keep the whole frame, pad to fill the canvas.
 * 'cover' ("Preencher"): fill the canvas, center-crop the overflow. Neither
 * ever stretches — both preserve the source's own aspect ratio. */
function scaleFilterFor(fit: EditorFit, w: number, h: number): string {
  if (fit === 'cover') {
    return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  }
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`;
}

export interface ExportOutcome {
  outputPath: string;
  durationSeconds: number;
}

export function scratchDirFor(jobId: string): string {
  return path.join(SCRATCH_ROOT, jobId);
}

export function cleanupExportScratch(jobId: string): void {
  fs.rmSync(scratchDirFor(jobId), { recursive: true, force: true });
}

export async function runExport(
  project: EditorExportProject,
  jobId: string,
  onProgress: (percent: number) => void
): Promise<ExportOutcome> {
  const scratchDir = scratchDirFor(jobId);
  const inputsDir = path.join(scratchDir, 'inputs');
  fs.mkdirSync(inputsDir, { recursive: true });

  function copyToLocalScratch(sourcePath: string): string {
    const localPath = path.join(inputsDir, `${crypto.randomUUID()}${path.extname(sourcePath)}`);
    fs.copyFileSync(sourcePath, localPath);
    return localPath;
  }

  const resolvedClips = project.clips.map((clip) => {
    const publicPath = resolvePublicMediaPath(clip.source.url);
    if (!publicPath) {
      throw new AppError('VALIDATION_ERROR', `Referenced media not found: ${clip.source.url}`, undefined, 400);
    }
    return { clip, filePath: copyToLocalScratch(publicPath) };
  });
  const resolvedAudio = project.audio.map((item) => {
    const publicPath = resolvePublicMediaPath(item.source.url);
    if (!publicPath) {
      throw new AppError('VALIDATION_ERROR', `Referenced audio not found: ${item.source.url}`, undefined, 400);
    }
    return { item, filePath: copyToLocalScratch(publicPath) };
  });

  const videoProbes = new Map<string, ProbeInfo>();
  for (const { clip, filePath } of resolvedClips) {
    if (clip.type === 'video') {
      try {
        videoProbes.set(clip.id, await probe(filePath));
      } catch (err) {
        throw new AppError('EXPORT_FAILED', 'Could not read one of the video clips.', String(err), 500);
      }
    }
  }

  // Reference dimensions come from the first visual clip — used to derive
  // the canvas for format 'auto', and to avoid upscaling small sources when
  // resolution is 'auto'.
  let referenceDimensions: { width: number; height: number } | null = null;
  const firstClip = resolvedClips[0];
  if (firstClip) {
    if (firstClip.clip.type === 'video') {
      const info = videoProbes.get(firstClip.clip.id);
      if (info?.width && info?.height) referenceDimensions = { width: info.width, height: info.height };
    } else {
      try {
        const dims = sizeOf(firstClip.filePath);
        if (dims.width && dims.height) referenceDimensions = { width: dims.width, height: dims.height };
      } catch {
        referenceDimensions = null; // Falls back to a sane default inside computeCanvasDimensions.
      }
    }
  }
  const canvas = computeCanvasDimensions(project.format, project.resolution, referenceDimensions);

  const command = ffmpeg();
  const filters: string[] = [];
  let inputIndex = 0;

  const clipVideoLabels: string[] = [];
  const clipAudioLabels: string[] = [];
  const clipDurations: number[] = [];

  for (const { clip, filePath } of resolvedClips) {
    const idx = inputIndex++;

    if (clip.type === 'image') {
      const duration = Math.max(0.2, clip.duration);
      // No `-t` on the input: with zoompan downstream, an input-side duration
      // limit produces MULTIPLE input frames (image2's default ~25fps), and
      // zoompan generates its whole `d`-frame cycle PER input frame it
      // receives — durations multiplied wildly (observed: 4s becoming ~400s).
      // A single `-loop 1` yields one logical input frame for zoompan to
      // drive; the explicit `trim` below is what actually bounds the clip,
      // for both the motion and no-motion cases alike.
      command.input(filePath).inputOptions(['-loop', '1']);
      const imageMovementStart = clip.movementTimingMode === 'custom' ? clip.movementStart : 0;
      const imageMovementDuration = clip.movementTimingMode === 'custom' ? clip.movementDuration : duration;
      const motionStage = buildMotionFilterStage(
        clip.motion,
        clip.motionIntensity,
        duration,
        imageMovementStart,
        imageMovementDuration,
        canvas.w,
        canvas.h,
        FPS,
        true
      );
      const visualChain = [
        `[${idx}:v]${scaleFilterFor(project.fit, canvas.w, canvas.h)}`,
        motionStage,
        `trim=duration=${num(duration)}`,
        'setpts=PTS-STARTPTS',
        'setsar=1',
        `fps=${FPS}`,
        `format=yuv420p[v${idx}]`,
      ]
        .filter(Boolean)
        .join(',');
      filters.push(visualChain);
      filters.push(`anullsrc=r=44100:cl=stereo,atrim=0:${num(duration)},asetpts=PTS-STARTPTS[a${idx}]`);
      clipVideoLabels.push(`v${idx}`);
      clipAudioLabels.push(`a${idx}`);
      clipDurations.push(duration);
    } else {
      command.input(filePath);
      const probeInfo = videoProbes.get(clip.id);
      const sourceDuration = probeInfo?.durationSeconds ?? clip.trimEnd;
      const trimEnd = Math.max(0.1, Math.min(clip.trimEnd, sourceDuration || clip.trimEnd));
      const trimStart = Math.max(0, Math.min(clip.trimStart, Math.max(0, trimEnd - 0.1)));
      const speed = clip.speed;
      const effectiveDuration = Math.max(0.1, (trimEnd - trimStart) / speed);

      const videoMovementStart = clip.movementTimingMode === 'custom' ? clip.movementStart : 0;
      const videoMovementDuration = clip.movementTimingMode === 'custom' ? clip.movementDuration : effectiveDuration;
      const motionStage = buildMotionFilterStage(
        clip.motion,
        clip.motionIntensity,
        effectiveDuration,
        videoMovementStart,
        videoMovementDuration,
        canvas.w,
        canvas.h,
        FPS,
        false
      );
      const visualChain = [
        `[${idx}:v]trim=start=${num(trimStart)}:end=${num(trimEnd)}`,
        `setpts=(PTS-STARTPTS)/${num(speed)}`,
        scaleFilterFor(project.fit, canvas.w, canvas.h),
        motionStage,
        'setsar=1',
        // zoompan already normalizes to fps=${FPS} internally — chaining a
        // second, separate fps filter right after it deadlocked the complex
        // filtergraph when an audio branch runs in parallel (observed:
        // "N buffers queued in out_0_0" growing unbounded, CPU pegged,
        // never completing). Only add it when motion isn't already handling
        // the frame rate.
        motionStage ? null : `fps=${FPS}`,
        `format=yuv420p[v${idx}]`,
      ]
        .filter(Boolean)
        .join(',');
      filters.push(visualChain);

      if (probeInfo?.hasAudio) {
        filters.push(
          `[${idx}:a]atrim=start=${num(trimStart)}:end=${num(trimEnd)},asetpts=PTS-STARTPTS,atempo=${num(speed)},volume=${num(clip.volume)}[a${idx}]`
        );
      } else {
        filters.push(`anullsrc=r=44100:cl=stereo,atrim=0:${num(effectiveDuration)},asetpts=PTS-STARTPTS[a${idx}]`);
      }

      clipVideoLabels.push(`v${idx}`);
      clipAudioLabels.push(`a${idx}`);
      clipDurations.push(effectiveDuration);
    }
  }

  let currentV = clipVideoLabels[0];
  let currentA = clipAudioLabels[0];
  let accumulated = clipDurations[0];

  for (let i = 1; i < resolvedClips.length; i++) {
    const prevClip = resolvedClips[i - 1].clip;
    const transition = project.transitions.find((t) => t.afterClipId === prevClip.id);
    const nextV = clipVideoLabels[i];
    const nextA = clipAudioLabels[i];
    const nextDuration = clipDurations[i];

    const outV = `vx${i}`;
    const outA = `ax${i}`;

    if (!transition || transition.type === 'none' || transition.duration <= 0) {
      filters.push(`[${currentV}][${nextV}]concat=n=2:v=1:a=0[${outV}]`);
      filters.push(`[${currentA}][${nextA}]concat=n=2:v=0:a=1[${outA}]`);
      accumulated += nextDuration;
    } else {
      const xfadeType = XFADE_MAP[transition.type];
      const d = Math.max(0.1, Math.min(transition.duration, accumulated - 0.1, nextDuration - 0.1));
      const offset = Math.max(0, accumulated - d);
      filters.push(`[${currentV}][${nextV}]xfade=transition=${xfadeType}:duration=${num(d)}:offset=${num(offset)}[${outV}]`);
      filters.push(`[${currentA}][${nextA}]acrossfade=d=${num(d)}[${outA}]`);
      accumulated = accumulated + nextDuration - d;
    }

    currentV = outV;
    currentA = outA;
  }

  const musicLabels: string[] = [];
  for (const { item, filePath } of resolvedAudio) {
    const idx = inputIndex++;
    command.input(filePath);
    const trimStart = Math.max(0, item.trimStart);
    const trimEnd = Math.max(trimStart + 0.1, item.trimEnd);
    const segDuration = trimEnd - trimStart;

    let chain = `[${idx}:a]atrim=start=${num(trimStart)}:end=${num(trimEnd)},asetpts=PTS-STARTPTS,volume=${num(item.volume)}`;
    if (item.fadeIn > 0) {
      chain += `,afade=t=in:st=0:d=${num(Math.min(item.fadeIn, segDuration))}`;
    }
    if (item.fadeOut > 0) {
      const fadeOutDuration = Math.min(item.fadeOut, segDuration);
      const fadeOutStart = Math.max(0, segDuration - fadeOutDuration);
      chain += `,afade=t=out:st=${num(fadeOutStart)}:d=${num(fadeOutDuration)}`;
    }
    const delayMs = Math.round(Math.max(0, item.startAt) * 1000);
    chain += `,adelay=${delayMs}|${delayMs}[m${idx}]`;
    filters.push(chain);
    musicLabels.push(`m${idx}`);
  }

  let finalAudioLabel = currentA;
  if (musicLabels.length > 0) {
    let musicMixLabel: string;
    if (musicLabels.length === 1) {
      filters.push(`[${musicLabels[0]}]anull[musicmix]`);
      musicMixLabel = 'musicmix';
    } else {
      filters.push(`${musicLabels.map((l) => `[${l}]`).join('')}amix=inputs=${musicLabels.length}:duration=longest:normalize=0[musicmix]`);
      musicMixLabel = 'musicmix';
    }
    filters.push(`[${currentA}][${musicMixLabel}]amix=inputs=2:duration=first:normalize=0[aout]`);
    finalAudioLabel = 'aout';
  }

  const outputId = crypto.randomUUID();
  const outputPath = path.join(scratchDir, `${outputId}.mp4`);
  const totalDuration = accumulated;

  await new Promise<void>((resolve, reject) => {
    command
      .complexFilter(filters)
      .outputOptions([
        '-map', `[${currentV}]`,
        '-map', `[${finalAudioLabel}]`,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '20',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p',
      ])
      .output(outputPath)
      .on('progress', (p) => {
        const seconds = parseTimemark(p.timemark ?? '0:00:00');
        const percent = totalDuration > 0 ? Math.min(99, Math.round((seconds / totalDuration) * 100)) : 0;
        onProgress(percent);
      })
      .on('error', (err) => reject(err))
      .on('end', () => resolve())
      .run();
  }).catch((err) => {
    throw new AppError('EXPORT_FAILED', 'Video export failed.', err instanceof Error ? err.message : String(err), 500);
  });

  return { outputPath, durationSeconds: totalDuration };
}
