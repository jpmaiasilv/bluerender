import { JobErrorPayload, JobStage } from './api';

export type EditorTransitionType = 'none' | 'fade' | 'dissolve' | 'slide' | 'zoom';

/** Controls aspect ratio only — never confused with pixel resolution (see
 * EditorResolution). 'auto' preserves the first visual clip's own ratio. */
export type EditorFormat = 'auto' | 'reels' | 'feed' | 'youtube' | 'square';

/** 'contain' ("Ajustar"): keep the whole frame, pad if needed. 'cover'
 * ("Preencher"): fill the frame, center-crop if needed. Never stretches. */
export type EditorFit = 'contain' | 'cover';

/** 'auto' picks a coherent size from the source/format without upscaling
 * small sources absurdly. */
export type EditorResolution = 'auto' | '720' | '1080';

export type EditorMotionType = 'none' | 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight' | 'panUp' | 'panDown' | 'kenBurns';
export type EditorMotionIntensity = 'soft' | 'medium';

/** 'full': movement spans the clip's whole effective duration (start=0).
 * 'custom': movement only happens within [movementStart, movementStart +
 * movementDuration] — before that window the clip holds its initial framing,
 * after it holds the final framing (see motionFilter.ts). */
export type EditorMovementTimingMode = 'full' | 'custom';

/** Media is always a URL already hosted by this backend — either a freshly
 * uploaded file (`/uploads/...`) or an existing AI-generated result
 * (`/results/...`). The export route resolves this to a local file path. */
export interface EditorMediaRef {
  url: string;
}

export interface EditorVideoClip {
  id: string;
  type: 'video';
  source: EditorMediaRef;
  trimStart: number;
  trimEnd: number;
  speed: number;
  volume: number;
  motion: EditorMotionType;
  motionIntensity: EditorMotionIntensity;
  movementTimingMode: EditorMovementTimingMode;
  movementStart: number;
  movementDuration: number;
}

export interface EditorImageClip {
  id: string;
  type: 'image';
  source: EditorMediaRef;
  duration: number;
  motion: EditorMotionType;
  motionIntensity: EditorMotionIntensity;
  movementTimingMode: EditorMovementTimingMode;
  movementStart: number;
  movementDuration: number;
}

export type EditorClip = EditorVideoClip | EditorImageClip;

export interface EditorTransition {
  id: string;
  afterClipId: string;
  type: EditorTransitionType;
  duration: number;
}

export interface EditorAudioItem {
  id: string;
  source: EditorMediaRef;
  trimStart: number;
  trimEnd: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  startAt: number;
}

export interface EditorExportProject {
  format: EditorFormat;
  fit: EditorFit;
  resolution: EditorResolution;
  clips: EditorClip[];
  transitions: EditorTransition[];
  audio: EditorAudioItem[];
}

export interface EditorExportResult {
  videoUrl: string;
  durationSeconds: number;
  generationTimeMs: number;
}

export interface EditorExportJobStatusResponse {
  jobId: string;
  stage: JobStage;
  progress: number;
  startedAt: number;
  result?: EditorExportResult;
  error?: JobErrorPayload;
}

export interface EditorExportCreateJobResponse {
  jobId: string;
  startedAt: number;
}

export interface EditorMediaUploadResponse {
  url: string;
  durationSeconds: number | null;
}
