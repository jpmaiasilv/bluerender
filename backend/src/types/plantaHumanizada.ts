import type { JobErrorPayload, JobStage } from './api';
import type { PlantaEngineTier } from '../config/plantaEngines';

export type PlantaRenderStyle = '3d_realista' | 'ilustracao' | '2d_tecnico' | 'preto_branco' | 'azul_branco' | 'tons_marrom';

export interface PlantaHumanizadaSettings {
  renderStyle: PlantaRenderStyle;
  customInstructions?: string;
  engine: PlantaEngineTier;
}

export interface PlantaJobResultPayload {
  requestId: string;
  engine: PlantaEngineTier;
  provider: string;
  model: string;
  imageUrl: string;
  prompt: string;
  generationTimeMs: number;
  resolution: { width: number; height: number } | null;
  status: 'Ready';
  creditsCharged: number;
  /** True only for a result produced by the /cleanup endpoint (Limpeza Técnica), never by the main /generate endpoint. */
  cleaned?: boolean;
}

export interface PlantaJobStatusResponse {
  jobId: string;
  stage: JobStage;
  providerStatus?: string;
  startedAt: number;
  result?: PlantaJobResultPayload;
  error?: JobErrorPayload;
}

export interface PlantaCreateJobResponse {
  jobId: string;
  startedAt: number;
}
