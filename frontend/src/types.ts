export type ProjectType = 'exterior' | 'interior';

export type PreserveLevel = 'low' | 'medium' | 'high';

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

/** LED strip/accent lighting in the scene — separate from the general `lighting` (time-of-day) setting above. 'automatic' lets the AI decide; 'off' explicitly excludes LED lighting. */
export type LedOption = 'off' | 'automatic' | 'white' | 'yellow';

export type AspectRatioOption = 'automatic' | '16:9' | '4:3' | '3:2' | '1:1' | '9:16';

/**
 * Render IA's own engine identity — which AI renders the image, not a
 * speed/quality tier. 'fast' / 'standard' / 'pro' are kept as ids for
 * backward compatibility with existing generation history (they used to be
 * literal tier names); 'gpt_image' is the newly added OpenAI engine.
 * 'standard' and 'pro' are demoted to the picker's "legacy models" section —
 * see EngineInfo.legacy and config/renderEngines.ts on the backend.
 */
export type EngineTier = 'fast' | 'standard' | 'pro' | 'gpt_image' | 'nano_banana_2';

export interface RenderSettings {
  projectType: ProjectType;
  preserveArchitecture: PreserveLevel;
  renderStyle: RenderStyleOption;
  lighting: LightingOption;
  environment: EnvironmentOption;
  led: LedOption;
  aspectRatio: AspectRatioOption;
  customInstructions?: string;
  engine: EngineTier;
}

export type JobStage = 'uploading' | 'sending' | 'rendering' | 'downloading' | 'complete' | 'error';

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
  engine: EngineTier;
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

export interface EngineInfo {
  id: EngineTier;
  technicalName: string;
  credits: number;
  /** Small badge shown in the picker, e.g. "new" on a newly added engine. */
  badge: 'new' | null;
  /** True for an older engine demoted to the picker's collapsed "legacy models" section. */
  legacy: boolean;
}

/** Which tool produced this entry — lets History filter across tools once more of them are wired up. */
export type HistoryToolId = 'render' | 'plantaHumanizada' | 'imagemPorTexto' | 'upscale' | 'videoIa' | 'ideaGenerator';

// --- Imagem por Texto (text-to-image) ---
// Deliberately its own commercial tier naming (Fast/Pro/Ultra) — see EngineTier
// above for Render IA's (Fast/Standard/Pro). Both ultimately map to the same
// backend models, but the two tools' tier ids are not interchangeable.
export type T2IEngineTier = 'fast' | 'pro' | 'ultra' | 'gpt_image' | 'nano_banana_2';

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

export interface T2IEngineInfo {
  id: T2IEngineTier;
  technicalName: string;
  credits: number;
  /** Small badge shown in the picker, e.g. "new" on a newly added engine. */
  badge: 'new' | null;
  /** True for an older engine demoted to the picker's collapsed "legacy models" section. */
  legacy: boolean;
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

// --- Gerador de Ideias (idea generator) ---
// Its own commercial tier naming (Fast/Pro/Ultra, same ids as Imagem por Texto)
// but its own dedicated cost table — see config/ideaGeneratorEngines.ts on the
// backend. Never assumed equal to another tool's costs without justification.
export type IdeaEngineTier = 'fast' | 'pro' | 'ultra' | 'gpt_image' | 'nano_banana_2';
export type IdeaGenerationMode = 'textToImage' | 'imageToImage';

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

/** Free-text label from a curated per-environment list, or the user's own "Outro" text. */
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
  preservation: PreservationLevel;
  transformation: TransformationLevel;
  lighting: IdeaLighting;
  camera: IdeaCamera;
  atmosphere: IdeaAtmosphere;
  materials: IdeaMaterialPreset;
  /** Same EnvironmentOption/LedOption as Render IA — standardized across every tool's advanced options. Named "surroundings" (not "environment") because `environment` above is already taken by this tool's own, differently-scoped concept (space type). */
  surroundings: EnvironmentOption;
  led: LedOption;
  creativity: IdeaCreativity;
}

export interface IdeaEngineInfo {
  id: IdeaEngineTier;
  technicalName: string;
  credits: number;
  /** Small badge shown in the picker, e.g. "new" on a newly added engine. */
  badge: 'new' | null;
  /** True for an older engine demoted to the picker's collapsed "legacy models" section. */
  legacy: boolean;
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

// --- Planta Humanizada ---
// Own commercial tier naming (Fast/Pro/Ultra, same ids as Imagem por Texto /
// Gerador de Ideias) with its own dedicated cost table on the backend — see
// backend/src/config/plantaEngines.ts.
export type PlantaEngineTier = 'fast' | 'pro' | 'ultra';

export type PlantaRenderStyle = '3d_realista' | 'ilustracao' | '2d_tecnico' | 'preto_branco' | 'azul_branco' | 'tons_marrom';

export interface PlantaHumanizadaSettings {
  renderStyle: PlantaRenderStyle;
  /** Optional free-form description — the uploaded floor plan is the primary input, this only adds context (same role as Render IA's customInstructions). */
  customInstructions?: string;
  engine: PlantaEngineTier;
}

export interface PlantaEngineInfo {
  id: PlantaEngineTier;
  technicalName: string;
  credits: number;
  recommended: boolean;
}

export interface PlantaJobResultPayload {
  requestId: string;
  /** 'fill' identifies a result from the newer OpenCV-mask + FLUX.1 Fill pipeline (generate-humanized-floorplan) — it has no Fast/Pro/Ultra tier, unlike the original FLUX.2 pipeline's PlantaEngineTier values. */
  engine: PlantaEngineTier | 'fill';
  provider: string;
  model: string;
  imageUrl: string;
  prompt: string;
  generationTimeMs: number;
  resolution: { width: number; height: number } | null;
  status: 'Ready';
  creditsCharged: number;
  /** True only for a result produced by the cleanup endpoint (Limpeza Técnica), never by the main generation endpoint. */
  cleaned?: boolean;
  /** Only present for a 'fill' result — how much the model's output drifted inside protected regions (0-1) before the wall-line correction was applied. Surfaced in PlantaDevInfoPanel for transparency. */
  protectedRegionDeviation?: number;
}

// --- Planta Humanizada: OpenCV mask + FLUX.1 Fill pipeline (generate-humanized-floorplan) ---
// Its own isolated request/response shapes — deliberately not merged into
// PlantaCreateJobResponse/PlantaJobStatusResponse above, which stay 1:1 with
// the original FLUX.2 endpoint (/api/planta-humanizada/generate).

export interface HumanizedFloorplanMaskResponse {
  /** Data URL (data:image/png;base64,...) — black=protected, white=editable, same dimensions as the uploaded image. */
  maskDataUrl: string;
  originalWidth: number;
  originalHeight: number;
}

/** GET /api/generate-humanized-floorplan/config — the single shared source of truth for the cost shown anywhere in the product; never hardcode this number in a component. */
export interface HumanizedFloorplanConfigResponse {
  costCredits: number;
}

/**
 * Deliberately its OWN stage type — NOT the shared `JobStage` every other
 * tool's route still uses. This pipeline has five meaningfully different
 * phases the UI shows distinctly (see HumanizedFloorplanGeneratingStatus.tsx).
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

export interface HumanizedFloorplanJobResultPayload {
  requestId: string;
  provider: 'bfl-fill';
  model: 'flux-pro-1.0-fill';
  imageUrl: string;
  prompt: string;
  generationTimeMs: number;
  resolution: { width: number; height: number };
  status: 'Ready';
  /** What BFL itself charged this app's BFL account — informational only, never what the user is billed. */
  providerCostUsd: number;
  providerCredits: number;
  /** What was actually debited from the user's Blue Render wallet — the only one of these three numbers with real billing effect. */
  walletDebitCredits: number;
  protectedRegionDeviation: number;
  /** How many rooms/objects the OpenAI vision step recognized — informational, confirms the step ran. */
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
// The new PRIMARY flow: upload -> style -> one OpenAI image-to-image call ->
// result. Deliberately its own, separate shapes — NOT reusing the advanced
// pipeline's HumanizedFloorplan* types above, which stay exactly as they
// are (untouched, dormant, reachable only via a future "advanced mode").

export const HUMANIZED_FLOORPLAN_SIMPLE_STYLES = ['contemporaneo', 'minimalista', 'classico', 'tropical', 'industrial', 'escandinavo'] as const;
export type HumanizedFloorplanSimpleStyle = (typeof HUMANIZED_FLOORPLAN_SIMPLE_STYLES)[number];

export const HUMANIZED_FLOORPLAN_LIGHTING_OPTIONS = ['clear_day', 'late_afternoon', 'golden_hour', 'night'] as const;
export type HumanizedFloorplanLighting = (typeof HUMANIZED_FLOORPLAN_LIGHTING_OPTIONS)[number];
export const HUMANIZED_FLOORPLAN_SURROUNDINGS_OPTIONS = ['auto', 'none', 'with'] as const;
export type HumanizedFloorplanSurroundings = (typeof HUMANIZED_FLOORPLAN_SURROUNDINGS_OPTIONS)[number];
export const HUMANIZED_FLOORPLAN_SURROUNDINGS_KINDS = ['lawn', 'forest', 'neighborhood', 'houses', 'custom'] as const;
export type HumanizedFloorplanSurroundingsKind = (typeof HUMANIZED_FLOORPLAN_SURROUNDINGS_KINDS)[number];
export const HUMANIZED_FLOORPLAN_TEXT_MODES = ['auto', 'preserve', 'remove'] as const;
export type HumanizedFloorplanTextMode = (typeof HUMANIZED_FLOORPLAN_TEXT_MODES)[number];
export const HUMANIZED_FLOORPLAN_FURNITURE_LEVELS = ['auto', 'essential', 'complete'] as const;
export type HumanizedFloorplanFurnitureLevel = (typeof HUMANIZED_FLOORPLAN_FURNITURE_LEVELS)[number];
export const HUMANIZED_FLOORPLAN_OUTPUT_FORMATS = ['original', 'square', 'landscape', 'portrait'] as const;
export type HumanizedFloorplanOutputFormat = (typeof HUMANIZED_FLOORPLAN_OUTPUT_FORMATS)[number];

export interface HumanizedFloorplanSimpleSettings {
  style: HumanizedFloorplanSimpleStyle;
  lighting: HumanizedFloorplanLighting;
  surroundings: HumanizedFloorplanSurroundings;
  surroundingsKind: HumanizedFloorplanSurroundingsKind;
  customSurroundings: string;
  textMode: HumanizedFloorplanTextMode;
  furnitureLevel: HumanizedFloorplanFurnitureLevel;
  outputFormat: HumanizedFloorplanOutputFormat;
  customInstructions: string;
}

export const DEFAULT_HUMANIZED_FLOORPLAN_SIMPLE_SETTINGS: HumanizedFloorplanSimpleSettings = {
  style: 'contemporaneo',
  lighting: 'clear_day',
  surroundings: 'auto',
  surroundingsKind: 'lawn',
  customSurroundings: '',
  textMode: 'auto',
  furnitureLevel: 'auto',
  outputFormat: 'original',
  customInstructions: '',
};

export const HUMANIZED_FLOORPLAN_GENERATION_MODES = ['standard', 'astra'] as const;
export type HumanizedFloorplanGenerationMode = (typeof HUMANIZED_FLOORPLAN_GENERATION_MODES)[number];

export type HumanizedFloorplanSimpleJobStage =
  | 'uploading'
  | 'analyzing'
  | 'generating'
  | 'finalizing'
  | 'analyzing_architecture'
  | 'preparing'
  | 'complete'
  | 'error';

export interface HumanizedFloorplanModeConfig {
  cost: number;
  available: boolean;
}

export interface HumanizedFloorplanSimpleConfig {
  /** Standard-mode price, kept for older callers. The UI reads the per-mode prices below. */
  costCredits: number;
  maxFileSizeBytes: number;
  /** Price and availability per mode — the ONLY source the UI uses; the client never decides what a generation costs. */
  humanizedFloorplan: { modes: Record<HumanizedFloorplanGenerationMode, HumanizedFloorplanModeConfig> };
}

/** What the backend exposes about one generation — no prompt, cost, provider payload or storage path. URLs are short-lived signed links. */
export interface HumanizedFloorplanSimpleHistoryItem {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  createdAt: string;
  completedAt: string | null;
  style: string;
  lighting: string | null;
  surroundings: string | null;
  surroundingsKind: string | null;
  customSurroundings: string | null;
  textMode: string | null;
  furnitureLevel: string | null;
  outputFormat: string | null;
  customInstructions: string | null;
  creditsUsed: number;
  /** Rows written before the Astra mode existed read as 'standard'. */
  generationMode: HumanizedFloorplanGenerationMode;
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
  mode?: HumanizedFloorplanGenerationMode;
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

// --- Vídeo IA ---
export type VideoDuration = 3 | 5 | 8;

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

export interface HistoryEntry {
  toolId: HistoryToolId;
  timestamp: number;
  // String, not EngineTier: 'imagemPorTexto'/'ideaGenerator' entries carry their
  // own tier id sets ('fast'|'pro'|'ultra'), different from Render IA's; 'videoIa'
  // entries carry a synthetic "video-{duration}s" label instead of a tier.
  engine: string;
  provider: string;
  model: string;
  creditsCharged: number;
  prompt: string;
  settings: RenderSettings | TextToImageSettings | IdeaGeneratorSettings | VideoGeneratorSettings | PlantaHumanizadaSettings;
  generationTimeMs: number;
  requestId: string;
  // For 'videoIa' entries, this holds the video URL (not an image) — History
  // renders it as a <video> when toolId === 'videoIa', see isVideoHistoryEntry.
  imageUrl: string;
  /** All generated images for this entry (Imagem por Texto / Gerador de Ideias can produce 1/2/4). imageUrl/requestId above always mirror images[0], so single-image consumers keep working unchanged. */
  images?: T2IGeneratedImage[];
  /** How many images were requested — lets History note a partial result. */
  quantity?: number;
  /** True only for a Planta Humanizada "Limpeza Técnica" entry — distinguishes it from the original generation entry in Testes Recentes/History (see historyEntryTitle). */
  cleaned?: boolean;
}

export function isRenderHistoryEntry(entry: HistoryEntry): entry is HistoryEntry & { settings: RenderSettings } {
  return entry.toolId === 'render';
}

export function isTextToImageHistoryEntry(
  entry: HistoryEntry
): entry is HistoryEntry & { settings: TextToImageSettings; engine: T2IEngineTier } {
  return entry.toolId === 'imagemPorTexto';
}

export function isIdeaGeneratorHistoryEntry(
  entry: HistoryEntry
): entry is HistoryEntry & { settings: IdeaGeneratorSettings; engine: IdeaEngineTier } {
  return entry.toolId === 'ideaGenerator';
}

export function isPlantaHumanizadaHistoryEntry(
  entry: HistoryEntry
): entry is HistoryEntry & { settings: PlantaHumanizadaSettings; engine: PlantaEngineTier } {
  return entry.toolId === 'plantaHumanizada';
}

export function isVideoHistoryEntry(entry: HistoryEntry): entry is HistoryEntry & { settings: VideoGeneratorSettings } {
  return entry.toolId === 'videoIa';
}

// --- Editor de Vídeo ---
export type EditorTransitionType = 'none' | 'fade' | 'dissolve' | 'slide' | 'zoom';
export type EditorClipSpeed = 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2;

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

/** 'full': movement spans the clip's whole effective duration. 'custom':
 * movement only happens within [movementStart, movementStart +
 * movementDuration] — the clip holds its initial framing before that window
 * and its final framing after it. */
export type EditorMovementTimingMode = 'full' | 'custom';

/** Always a URL already hosted by this backend (an editor upload under
 * /uploads/, or an existing AI result under /results/) — the same shape the
 * backend export pipeline expects, so the client project maps to the export
 * payload with no translation beyond stripping UI-only fields. */
export interface EditorMediaRef {
  url: string;
}

export interface EditorVideoClip {
  id: string;
  type: 'video';
  name: string;
  source: EditorMediaRef;
  /** Full duration of the underlying media — bounds trim handles. */
  sourceDuration: number;
  trimStart: number;
  trimEnd: number;
  speed: EditorClipSpeed;
  volume: number;
  motion: EditorMotionType;
  motionIntensity: EditorMotionIntensity;
  movementTimingMode: EditorMovementTimingMode;
  movementStart: number;
  movementDuration: number;
  /** True while the file is still being uploaded — clip is shown but not yet exportable. */
  uploading?: boolean;
}

export interface EditorImageClip {
  id: string;
  type: 'image';
  name: string;
  source: EditorMediaRef;
  duration: number;
  motion: EditorMotionType;
  motionIntensity: EditorMotionIntensity;
  movementTimingMode: EditorMovementTimingMode;
  movementStart: number;
  movementDuration: number;
  uploading?: boolean;
}

export type EditorClip = EditorVideoClip | EditorImageClip;

export interface EditorTransition {
  id: string;
  afterClipId: string;
  type: EditorTransitionType;
  duration: number;
}

/** MVP: a single music slot, always starting at the beginning of the timeline. */
export interface EditorMusicItem {
  id: string;
  name: string;
  source: EditorMediaRef;
  sourceDuration: number;
  trimStart: number;
  trimEnd: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  uploading?: boolean;
}

export interface EditorMediaUploadResponse {
  url: string;
  durationSeconds: number | null;
}

export interface EditorExportRequestProject {
  format: EditorFormat;
  fit: EditorFit;
  resolution: EditorResolution;
  clips: Array<
    | {
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
    | {
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
  >;
  transitions: Array<{ id: string; afterClipId: string; type: EditorTransitionType; duration: number }>;
  audio: Array<{
    id: string;
    source: EditorMediaRef;
    trimStart: number;
    trimEnd: number;
    volume: number;
    fadeIn: number;
    fadeOut: number;
    startAt: number;
  }>;
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

// --- Arquiteto Estagiário (chat assistant) ------------------------------------

export type ArchitectChatAttachmentKind = 'image' | 'audio' | 'document';

export interface ArchitectChatAttachment {
  kind: ArchitectChatAttachmentKind;
  url: string | null;
  originalFileName: string | null;
  /** Only present for kind 'audio' — what the assistant actually understood from it. */
  transcript: string | null;
}

export interface ArchitectChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments: ArchitectChatAttachment[];
  status: 'completed' | 'failed';
  errorCode: ErrorCode | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface ArchitectChatConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArchitectChatConversationDetail extends ArchitectChatConversationSummary {
  messages: ArchitectChatMessage[];
}

export interface ArchitectChatConfig {
  available: boolean;
  costCredits: number;
}

/** One event of the message-sending SSE stream. */
export type ArchitectChatStreamEvent =
  | { type: 'start'; conversationId: string; userMessageId: string; title: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; conversationId: string; assistantMessageId: string; title: string }
  | { type: 'error'; code: ErrorCode; message: string; conversationId?: string; assistantMessageId?: string };
