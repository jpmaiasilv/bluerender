import type { VideoDuration } from '../config/videoEngines';
import type { JobErrorPayload, JobStage } from './api';

export interface VideoGeneratorSettings {
  prompt: string;
  durationSeconds: VideoDuration;
}

export interface VideoJobResultPayload {
  provider: string;
  model: string;
  prompt: string;
  videoUrl: string;
  requestId: string;
  durationSeconds: number;
  generationTimeMs: number;
  creditsCharged: number;
  status: 'Ready';
}

export interface VideoJobStatusResponse {
  jobId: string;
  stage: JobStage;
  startedAt: number;
  result?: VideoJobResultPayload;
  error?: JobErrorPayload;
}

export interface VideoCreateJobResponse {
  jobId: string;
  startedAt: number;
}

export interface VideoPricingResponse {
  durations: VideoDuration[];
  creditsByDuration: Record<VideoDuration, number>;
}
