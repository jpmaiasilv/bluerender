import {
  AspectRatioOption,
  EnvironmentOption,
  IdeaAtmosphere,
  IdeaCamera,
  IdeaCreativity,
  IdeaEnvironment,
  IdeaGoal,
  IdeaImageCount,
  IdeaLighting,
  IdeaMaterialPreset,
  IdeaStyle,
  JobStage,
  LedOption,
  LightingOption,
  PlantaRenderStyle,
  PreservationLevel,
  PreserveLevel,
  ProjectType,
  RenderStyleOption,
  T2IAspectRatio,
  T2ICreativity,
  T2IImageCount,
  T2ILighting,
  T2IProjectType,
  T2IStyle,
  TransformationLevel,
  VideoDuration,
} from '../types';

// Value-only option lists. Display labels always come from the active
// language's `messages` object (see i18n/) — never hardcoded here.
export const PROJECT_TYPE_VALUES: ProjectType[] = ['exterior', 'interior'];

export const PRESERVE_LEVEL_VALUES: PreserveLevel[] = ['low', 'medium', 'high'];

export const RENDER_STYLE_VALUES: RenderStyleOption[] = [
  'photorealistic',
  'corona',
  'vray',
  'enscape',
  'lumion',
  'minimal_clean',
  'cinematic',
  'custom',
];

export const LIGHTING_VALUES: LightingOption[] = ['daylight', 'golden_hour', 'sunset', 'night'];

export const LED_VALUES: LedOption[] = ['off', 'automatic', 'white', 'yellow'];

export const ENVIRONMENT_VALUES: EnvironmentOption[] = [
  'preserve_original',
  'urban',
  'residential',
  'tropical',
  'nature',
  'minimal',
];

export const ASPECT_RATIO_VALUES: AspectRatioOption[] = ['automatic', '16:9', '4:3', '3:2', '1:1', '9:16'];

export const JOB_STAGE_ORDER: JobStage[] = ['uploading', 'sending', 'rendering', 'downloading', 'complete'];

// --- Planta Humanizada ---
export const PLANTA_RENDER_STYLE_VALUES: PlantaRenderStyle[] = [
  '3d_realista',
  'ilustracao',
  '2d_tecnico',
  'preto_branco',
  'azul_branco',
  'tons_marrom',
];

// --- Imagem por Texto ---
export const T2I_STYLE_VALUES: T2IStyle[] = [
  'livre',
  'fotorealista',
  'contemporaneo',
  'minimalista',
  'tropical',
  'luxo',
  'brutalista',
  'japandi',
];

export const T2I_PROJECT_TYPE_VALUES: T2IProjectType[] = ['livre', 'exterior', 'interior', 'paisagismo', 'comercial'];

export const T2I_LIGHTING_VALUES: T2ILighting[] = [
  'automatica',
  'dia',
  'manha',
  'golden_hour',
  'por_do_sol',
  'noturna',
  'nublado',
  'estudio',
];

export const T2I_CREATIVITY_VALUES: T2ICreativity[] = ['baixa', 'equilibrada', 'alta'];

export const T2I_ASPECT_RATIO_VALUES: T2IAspectRatio[] = ['automatic', '16:9', '4:3', '3:2', '1:1', '9:16', '2:3'];

export const T2I_IMAGE_COUNT_VALUES: T2IImageCount[] = [1, 2, 4];

// --- Gerador de Ideias ---
export const IDEA_ENVIRONMENT_VALUES: IdeaEnvironment[] = ['livre', 'interior', 'exterior', 'paisagismo', 'comercial'];

/**
 * Frontend-only key for the Space dropdown — resolved to a localized label
 * before being sent as `space` (a plain string) to the backend, which only
 * ever treats it as a prompt fragment, never branches on it. 'outro' reveals a
 * free-text field instead of using its own label.
 */
export type IdeaSpaceKey =
  | 'sala_estar'
  | 'sala_jantar'
  | 'cozinha'
  | 'quarto'
  | 'banheiro'
  | 'closet'
  | 'home_office'
  | 'escritorio'
  | 'hall_entrada'
  | 'lavanderia'
  | 'recepcao'
  | 'residencia'
  | 'fachada'
  | 'edificio_residencial'
  | 'edificio_comercial'
  | 'area_gourmet'
  | 'varanda'
  | 'piscina'
  | 'garagem'
  | 'entrada'
  | 'area_lazer'
  | 'jardim_residencial'
  | 'area_piscina'
  | 'patio'
  | 'praca'
  | 'terraco'
  | 'area_externa'
  | 'jardim_interno'
  | 'loja'
  | 'restaurante'
  | 'cafe'
  | 'clinica'
  | 'hotel'
  | 'showroom'
  | 'salao'
  | 'outro';

export const IDEA_SPACE_KEYS_BY_ENVIRONMENT: Record<Exclude<IdeaEnvironment, 'livre'>, IdeaSpaceKey[]> = {
  interior: [
    'sala_estar',
    'sala_jantar',
    'cozinha',
    'quarto',
    'banheiro',
    'closet',
    'home_office',
    'escritorio',
    'hall_entrada',
    'lavanderia',
    'recepcao',
    'outro',
  ],
  exterior: [
    'residencia',
    'fachada',
    'edificio_residencial',
    'edificio_comercial',
    'area_gourmet',
    'varanda',
    'piscina',
    'garagem',
    'entrada',
    'area_lazer',
    'outro',
  ],
  paisagismo: ['jardim_residencial', 'area_piscina', 'patio', 'praca', 'terraco', 'varanda', 'area_externa', 'jardim_interno', 'outro'],
  comercial: ['loja', 'restaurante', 'cafe', 'escritorio', 'clinica', 'hotel', 'recepcao', 'showroom', 'salao', 'outro'],
};

export const IDEA_GOAL_VALUES: IdeaGoal[] = [
  'livre',
  'reforma_completa',
  'nova_decoracao',
  'novos_materiais',
  'nova_paleta',
  'novo_mobiliario',
  'nova_iluminacao',
  'nova_fachada',
  'paisagismo',
  'atmosfera',
];

/** Which goals are shown for each environment — irrelevant ones are hidden rather than disabled. */
export const IDEA_GOALS_BY_ENVIRONMENT: Record<IdeaEnvironment, IdeaGoal[]> = {
  livre: IDEA_GOAL_VALUES,
  interior: ['nova_decoracao', 'novos_materiais', 'nova_paleta', 'novo_mobiliario', 'nova_iluminacao', 'reforma_completa', 'atmosfera', 'livre'],
  exterior: ['nova_fachada', 'novos_materiais', 'nova_paleta', 'paisagismo', 'nova_iluminacao', 'reforma_completa', 'atmosfera', 'livre'],
  paisagismo: ['paisagismo', 'novos_materiais', 'novo_mobiliario', 'nova_iluminacao', 'reforma_completa', 'atmosfera', 'livre'],
  comercial: ['reforma_completa', 'nova_decoracao', 'novos_materiais', 'nova_paleta', 'novo_mobiliario', 'nova_iluminacao', 'atmosfera', 'livre'],
};

export const IDEA_STYLE_VALUES: IdeaStyle[] = [
  'automatico',
  'contemporaneo',
  'moderno',
  'minimalista',
  'japandi',
  'tropical',
  'luxo',
  'industrial',
  'brutalista',
  'mediterraneo',
  'escandinavo',
  'classico',
  'mid_century',
];

export const IDEA_PRESERVATION_VALUES: PreservationLevel[] = ['baixa', 'media', 'alta'];
export const IDEA_TRANSFORMATION_VALUES: TransformationLevel[] = ['sutil', 'equilibrada', 'criativa'];

export const IDEA_LIGHTING_VALUES: IdeaLighting[] = [
  'automatica',
  'luz_natural',
  'dia',
  'golden_hour',
  'por_do_sol',
  'noturna',
  'nublado',
  'quente',
];

/** Shown only without a reference image — with one, the camera control is replaced by a "preserve camera" default. */
export const IDEA_CAMERA_VALUES_NO_IMAGE: IdeaCamera[] = ['automatica', 'frontal', 'perspectiva', 'grande_angular', 'aerea', 'detalhe'];

export const IDEA_ATMOSPHERE_VALUES: IdeaAtmosphere[] = [
  'neutra',
  'aconchegante',
  'sofisticada',
  'dramatica',
  'natural',
  'minimalista',
  'cinematografica',
];

export const IDEA_MATERIAL_VALUES: IdeaMaterialPreset[] = ['automatico', 'madeira', 'pedra_natural', 'concreto', 'marmore', 'tons_neutros'];

export const IDEA_CREATIVITY_VALUES: IdeaCreativity[] = ['baixa', 'equilibrada', 'alta'];

export const IDEA_IMAGE_COUNT_VALUES: IdeaImageCount[] = [1, 2, 4];

// --- Vídeo IA ---
export const VIDEO_DURATION_VALUES: VideoDuration[] = [3, 5, 8];
