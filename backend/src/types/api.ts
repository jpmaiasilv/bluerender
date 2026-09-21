import type { RenderEngineId } from '../config/renderEngines';

export type ProjectType = 'exterior' | 'interior';

export type PreserveLevel = 'low' | 'medium' | 'high';

// Aesthetic/rendering-technique references (not literal renderer integrations) —
// they only steer the prompt sent to the AI model.
export type RenderStyleOption =
  | 'photorealistic'
  | 'corona'
  | 'vray'
  | 'enscape'
  | 'lumion'
  | 'minimal_clean'
  | 'cinematic'
  | 'custom';

export type LightingOption = 'daylight' | 'golden_hour' | 'sunset' | 'night';

export type EnvironmentOption =
  | 'preserve_original'
  | 'urban'
  | 'residential'
  | 'tropical'
  | 'nature'
  | 'minimal';

/** LED strip/accent lighting in the scene — separate from `lighting` (time-of-day). 'automatic' lets the model decide; 'off' explicitly excludes LED lighting. */
export type LedOption = 'off' | 'automatic' | 'white' | 'yellow';

export type AspectRatioOption = 'automatic' | '16:9' | '4:3' | '3:2' | '1:1' | '9:16';

export interface RenderSettings {
  projectType: ProjectType;
  preserveArchitecture: PreserveLevel;
  renderStyle: RenderStyleOption;
  lighting: LightingOption;
  environment: EnvironmentOption;
  led: LedOption;
  aspectRatio: AspectRatioOption;
  customInstructions?: string;
  engine: RenderEngineId;
}

export type JobStage =
  | 'uploading'
  | 'sending'
  | 'rendering'
  | 'downloading'
  | 'complete'
  | 'error';

export type ErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'GENERATION_FAILED'
  | 'GENERATION_TIMEOUT'
  | 'IMAGE_UPLOAD_FAILED'
  | 'RESULT_IMAGE_UNAVAILABLE'
  | 'RESULT_VIDEO_UNAVAILABLE'
  | 'INVALID_API_KEY'
  | 'INSUFFICIENT_CREDITS'
  | 'FILE_TOO_LARGE'
  | 'UNAUTHENTICATED'
  | 'VALIDATION_ERROR'
  | 'MEDIA_UPLOAD_FAILED'
  | 'EXPORT_FAILED'
  | 'UNKNOWN_ERROR';

export interface JobErrorPayload {
  code: ErrorCode;
  message: string;
  details?: string;
}

export interface JobResultPayload {
  requestId: string;
  engine: RenderEngineId;
  provider: string;
  model: string;
  imageUrl: string;
  prompt: string;
  generationTimeMs: number;
  resolution: { width: number; height: number } | null;
  cost: { amount: number | null; currency: string; isEstimate: boolean; note: string };
  status: string;
  creditsCharged: number;
}

export interface JobStatusResponse {
  jobId: string;
  stage: JobStage;
  providerStatus?: string;
  startedAt: number;
  result?: JobResultPayload;
  error?: JobErrorPayload;
}

export interface CreateJobResponse {
  jobId: string;
  startedAt: number;
}
