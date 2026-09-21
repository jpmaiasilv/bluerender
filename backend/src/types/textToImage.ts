import type { T2IEngineTier } from '../config/textToImageEngines';
import type { EnvironmentOption, JobErrorPayload, JobStage, LedOption } from './api';

export type T2IProjectType = 'livre' | 'exterior' | 'interior' | 'paisagismo' | 'comercial';

export type T2IStyle =
  | 'livre'
  | 'fotorealista'
  | 'contemporaneo'
  | 'minimalista'
  | 'tropical'
  | 'luxo'
  | 'brutalista'
  | 'japandi';

export type T2ILighting =
  | 'automatica'
  | 'dia'
  | 'manha'
  | 'golden_hour'
  | 'por_do_sol'
  | 'noturna'
  | 'nublado'
  | 'estudio';

export type T2ICreativity = 'baixa' | 'equilibrada' | 'alta';

export type T2IAspectRatio = 'automatic' | '16:9' | '4:3' | '3:2' | '1:1' | '9:16' | '2:3';

export type T2IImageCount = 1 | 2 | 4;

export interface TextToImageSettings {
  prompt: string;
  engine: T2IEngineTier;
  count: T2IImageCount;
  aspectRatio: T2IAspectRatio;
  style: T2IStyle;
  projectType: T2IProjectType;
  lighting: T2ILighting;
  /** Same EnvironmentOption/LedOption as Render IA — standardized across every tool's advanced options. */
  environment: EnvironmentOption;
  led: LedOption;
  creativity: T2ICreativity;
}

export interface T2IGeneratedImage {
  requestId: string;
  imageUrl: string;
  resolution: { width: number; height: number } | null;
}

export interface T2IJobResultPayload {
  engine: T2IEngineTier;
  provider: string;
  model: string;
  prompt: string;
  images: T2IGeneratedImage[];
  requestedCount: T2IImageCount;
  generationTimeMs: number;
  creditsCharged: number;
  status: 'Ready' | 'Partial';
}

export interface T2IJobStatusResponse {
  jobId: string;
  stage: JobStage;
  startedAt: number;
  result?: T2IJobResultPayload;
  error?: JobErrorPayload;
}

export interface T2ICreateJobResponse {
  jobId: string;
  startedAt: number;
}
