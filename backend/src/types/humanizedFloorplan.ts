import type { JobErrorPayload } from './api';

export interface HumanizedFloorplanSettings {
  prompt?: string;
  steps?: number;
  guidance?: number;
}

export interface HumanizedFloorplanMaskResponse {
  /** Data URL (data:image/png;base64,...) — no extra endpoint round-trip needed to preview it. */
  maskDataUrl: string;
  originalWidth: number;
  originalHeight: number;
}

/**
 * Deliberately its OWN stage type — NOT types/api.ts's shared `JobStage`,
 * which every other tool's route (Render/Redesign/Vídeo/Upscale/the old
 * Planta Humanizada pipeline) still uses unchanged. This pipeline now has
 * five meaningfully different phases the frontend must show distinctly
 * (requirement: "analisando arquitetura; reconhecendo móveis; refinando
 * objetos; humanizando planta; validando resultado") — adding them here
 * keeps that change fully isolated to this one route/type file.
 */
export type HumanizedFloorplanJobStage =
  | 'uploading'
  | 'analyzing_structure'
  | 'recognizing_furniture'
  | 'refining_objects'
  | 'humanizing'
  | 'validating'
  | 'complete'
  | 'error';

export interface HumanizedFloorplanConfigResponse {
  /** Single shared source of truth for the cost shown anywhere in the product — see config/humanizedFloorplanEngine.ts. The frontend fetches this instead of hardcoding a number. */
  costCredits: number;
}

export interface HumanizedFloorplanJobResultPayload {
  requestId: string;
  provider: 'bfl-fill';
  model: 'flux-pro-1.0-fill';
  imageUrl: string;
  prompt: string;
  generationTimeMs: number;
  resolution: { width: number; height: number };
  status: 'Ready';
  /** What BFL itself charged this app's BFL account for this one call — informational only, never what the user is billed. */
  providerCostUsd: number;
  providerCredits: number;
  /** What was actually debited from the user's Blue Render wallet for this result — the only one of these three numbers with real billing effect. */
  walletDebitCredits: number;
  /** How much the model's output drifted from the original inside the protected regions (0 = identical), before the wall-line correction was applied. Surfaced for transparency, even on an accepted result. */
  protectedRegionDeviation: number;
  /** How many rooms/objects the OpenAI vision step recognized (after dedup + structural combination) — purely informational, confirms the step actually ran. */
  openAiRoomsDetected: number;
  openAiObjectsDetected: number;
}

export interface HumanizedFloorplanJobStatusResponse {
  jobId: string;
  stage: HumanizedFloorplanJobStage;
  providerStatus?: string;
  startedAt: number;
  result?: HumanizedFloorplanJobResultPayload;
  error?: JobErrorPayload;
}

export interface HumanizedFloorplanCreateJobResponse {
  jobId: string;
  startedAt: number;
}

// --- Planta Humanizada SIMPLE flow (2026-09-19 pivot) ---
// Deliberately its own, separate shapes — NOT reusing the advanced
// pipeline's HumanizedFloorplanJob* types above, which stay exactly as they
// are (the advanced pipeline is untouched, just no longer the main flow).

export type HumanizedFloorplanSimpleJobStage =
  | 'uploading'
  | 'analyzing'
  | 'generating'
  | 'finalizing'
  // Astra mode: real pipeline stages, persisted by the backend.
  | 'analyzing_architecture'
  | 'preparing'
  | 'complete'
  | 'error';

export interface HumanizedFloorplanSimpleConfigResponse {
  /** Single source of truth for the cost — read from the same backend constant the charge uses. */
  costCredits: number;
  maxFileSizeBytes: number;
  /** Price and availability of each generation mode — the ONLY source the UI uses for what a generation costs. */
  humanizedFloorplan: { modes: { standard: { cost: number; available: boolean }; astra: { cost: number; available: boolean } } };
}

/** Everything the browser may know about a generation: no prompt, provider payload, cost, usage or storage path. URLs are short-lived signed links. */
export interface HumanizedFloorplanSimpleHistoryItem {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  createdAt: string;
  completedAt: string | null;
  style: string;
  lighting: string;
  surroundings: string;
  surroundingsKind: string | null;
  customSurroundings: string | null;
  textMode: string;
  furnitureLevel: string;
  outputFormat: string;
  customInstructions: string | null;
  creditsUsed: number;
  generationMode: 'standard' | 'astra';
  hasReference: boolean;
  originalFileName: string | null;
  errorCode: string | null;
  thumbnailUrl: string | null;
  resultUrl: string | null;
  originalUrl: string | null;
  referenceUrl: string | null;
  downloadPngUrl: string | null;
  downloadJpgUrl: string | null;
}

export interface HumanizedFloorplanSimpleJobStatusResponse {
  jobId: string;
  stage: HumanizedFloorplanSimpleJobStage;
  mode: 'standard' | 'astra';
  startedAt: number;
  /** Present once the generation is finished (completed or failed): the full item with signed URLs. */
  item?: HumanizedFloorplanSimpleHistoryItem;
  result?: HumanizedFloorplanSimpleHistoryItem;
  error?: JobErrorPayload;
}

export interface HumanizedFloorplanSimpleCreateJobResponse {
  jobId: string;
  startedAt: number;
}
