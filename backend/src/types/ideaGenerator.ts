import type { IdeaEngineTier, IdeaGenerationMode } from '../config/ideaGeneratorEngines';
import type { EnvironmentOption, JobErrorPayload, JobStage, LedOption } from './api';

export type IdeaEnvironment = 'livre' | 'interior' | 'exterior' | 'paisagismo' | 'comercial';

export type IdeaGoal =
  | 'livre'
  | 'reforma_completa'
  | 'nova_decoracao'
  | 'novos_materiais'
  | 'nova_paleta'
  | 'novo_mobiliario'
  | 'nova_iluminacao'
  | 'nova_fachada'
  | 'paisagismo'
  | 'atmosfera';

export type IdeaStyle =
  | 'automatico'
  | 'contemporaneo'
  | 'moderno'
  | 'minimalista'
  | 'japandi'
  | 'tropical'
  | 'luxo'
  | 'industrial'
  | 'brutalista'
  | 'mediterraneo'
  | 'escandinavo'
  | 'classico'
  | 'mid_century';

/**
 * Free-form label, not an enum: the frontend offers a curated list per
 * IdeaEnvironment (see lib/options.ts) plus an "Outro" option with typed text —
 * the backend only ever uses this as a natural-language fragment in the built
 * prompt, so it doesn't need to branch on its exact value the way it does for
 * environment/goal/style.
 */
export type IdeaSpace = string;

export type PreservationLevel = 'baixa' | 'media' | 'alta';
export type TransformationLevel = 'sutil' | 'equilibrada' | 'criativa';

export type IdeaLighting =
  | 'automatica'
  | 'luz_natural'
  | 'dia'
  | 'golden_hour'
  | 'por_do_sol'
  | 'noturna'
  | 'nublado'
  | 'quente';

/** 'preservar' only makes sense with a reference image; the frontend defaults to it whenever one is present. */
export type IdeaCamera = 'automatica' | 'frontal' | 'perspectiva' | 'grande_angular' | 'aerea' | 'detalhe' | 'preservar';

export type IdeaAtmosphere = 'neutra' | 'aconchegante' | 'sofisticada' | 'dramatica' | 'natural' | 'minimalista' | 'cinematografica';

export type IdeaMaterialPreset = 'automatico' | 'madeira' | 'pedra_natural' | 'concreto' | 'marmore' | 'tons_neutros';

export type IdeaCreativity = 'baixa' | 'equilibrada' | 'alta';

export type IdeaImageCount = 1 | 2 | 4;

export interface IdeaGeneratorSettings {
  environment: IdeaEnvironment;
  space: IdeaSpace;
  goal: IdeaGoal;
  style: IdeaStyle;
  details?: string;
  engine: IdeaEngineTier;
  count: IdeaImageCount;
  /** Only meaningful (and only sent by the frontend) when a reference image is attached. */
  preservation: PreservationLevel;
  transformation: TransformationLevel;
  lighting: IdeaLighting;
  camera: IdeaCamera;
  atmosphere: IdeaAtmosphere;
  materials: IdeaMaterialPreset;
  /** Same EnvironmentOption/LedOption as Render IA — standardized across every tool's advanced options. Named "surroundings" because `environment` above already means this tool's own space-type concept. */
  surroundings: EnvironmentOption;
  led: LedOption;
  creativity: IdeaCreativity;
}

export interface IdeaGeneratedImage {
  requestId: string;
  imageUrl: string;
  resolution: { width: number; height: number } | null;
}

export interface IdeaJobResultPayload {
  mode: IdeaGenerationMode;
  engine: IdeaEngineTier;
  provider: string;
  model: string;
  prompt: string;
  images: IdeaGeneratedImage[];
  requestedCount: IdeaImageCount;
  generationTimeMs: number;
  creditsCharged: number;
  status: 'Ready' | 'Partial';
}

export interface IdeaJobStatusResponse {
  jobId: string;
  stage: JobStage;
  startedAt: number;
  result?: IdeaJobResultPayload;
  error?: JobErrorPayload;
}

export interface IdeaCreateJobResponse {
  jobId: string;
  startedAt: number;
}
