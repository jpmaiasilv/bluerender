import {
  IdeaAtmosphere,
  IdeaCamera,
  IdeaEnvironment,
  IdeaGeneratorSettings,
  IdeaGoal,
  IdeaLighting,
  IdeaMaterialPreset,
  IdeaStyle,
} from '../types/ideaGenerator';
import { EnvironmentOption, LedOption } from '../types/api';

/**
 * Centralized builder for the Idea Generator's FLUX prompt. Kept deliberately
 * separate from promptBuilder.ts (Render IA) and textToImagePromptBuilder.ts —
 * this tool's purpose is different from both: Render IA turns an existing
 * model/project into a realistic render of THAT SAME project; Imagem por Texto
 * is a free-form prompt tool; the Idea Generator explores NEW design
 * possibilities from guided presets, optionally anchored to a reference image
 * it may substantially reinterpret. The framing sentence below is what encodes
 * that difference — it is never reused verbatim from the other two builders.
 */

const BASE_FRAMING =
  'Explore new architectural and interior design possibilities for the following brief. This is a creative concept exploration, not a literal reproduction of any existing project.';

const REIMAGINE_FRAMING =
  'A reference image is provided. Reimagine and propose a new design direction for the space shown in it, guided by the brief below.';

const ENVIRONMENT_CLAUSES: Partial<Record<IdeaEnvironment, string>> = {
  interior: 'Interior space.',
  exterior: 'Exterior architecture.',
  paisagismo: 'Landscape and outdoor design.',
  comercial: 'Commercial space.',
};

const GOAL_CLAUSES: Partial<Record<IdeaGoal, string>> = {
  reforma_completa: 'Explore a complete renovation: materials, furniture, lighting and overall composition may all change.',
  nova_decoracao: 'Focus on new decoration and interior styling — furniture, textiles, art and accessories.',
  novos_materiais: 'Focus on new materials and finishes for the main surfaces.',
  nova_paleta: 'Focus on a new color palette while keeping the overall composition familiar.',
  novo_mobiliario: 'Focus on new furniture selection and arrangement.',
  nova_iluminacao: 'Focus on a new lighting design and mood.',
  nova_fachada: 'Focus on a new facade design and exterior materials.',
  paisagismo: 'Focus on landscaping: vegetation, planting design and outdoor materials.',
  atmosfera: 'Focus on the overall atmosphere and mood, keeping materials and furniture close to what already fits the brief.',
};

const STYLE_CLAUSES: Partial<Record<IdeaStyle, string>> = {
  contemporaneo: 'Contemporary style: clean lines, mixed modern materials, understated elegance.',
  moderno: 'Modern style: functional forms, simplified geometry, restrained ornamentation.',
  minimalista: 'Minimalist style: restrained geometry, neutral palette, few materials used with precision.',
  japandi: 'Japandi style: fusion of Japanese and Scandinavian sensibilities, natural light woods, warm minimalism, calm neutral tones.',
  tropical: 'Tropical style: natural ventilation, wood and stone materials, lush vegetation, indoor-outdoor integration.',
  luxo: 'Luxury style: premium materials such as natural stone and hardwood, refined detailing, elevated finishes.',
  industrial: 'Industrial style: exposed structure, metal and raw materials, utilitarian details with character.',
  brutalista: 'Brutalist style: raw exposed concrete, bold monolithic massing, strong geometric shadows.',
  mediterraneo: 'Mediterranean style: whitewashed or textured walls, natural stone, warm earthy tones, relaxed coastal feel.',
  escandinavo: 'Scandinavian style: light woods, soft neutral tones, cozy minimalism, functional simplicity.',
  classico: 'Classic style: proportion-driven composition, refined mouldings and traditional materials.',
  mid_century: 'Mid-century modern style: organic curves, warm wood tones, retro-modern furniture silhouettes.',
};

const PRESERVATION_CLAUSES: Record<string, string> = {
  alta: 'Preserve the original architecture strictly: keep walls, openings, volumes, camera position and overall composition unchanged. Only reinterpret the surface-level design described in the brief.',
  media: 'Keep the structural geometry and composition intact while allowing the brief to meaningfully reshape materials, furniture, lighting and atmosphere.',
  baixa: "Keep the space loosely recognizable, but allow the brief to substantially reinterpret its composition and secondary architectural details.",
};

const TRANSFORMATION_CLAUSES: Record<string, string> = {
  sutil: 'Apply the brief subtly — a refined, close variation of the existing design.',
  equilibrada: 'Apply the brief with a balanced degree of creative freedom.',
  criativa: 'Apply the brief boldly, with strong creative freedom over materials, furniture, colors and atmosphere.',
};

const LIGHTING_CLAUSES: Partial<Record<IdeaLighting, string>> = {
  luz_natural: 'Soft, even natural light.',
  dia: 'Bright natural daytime lighting, clear sky, soft realistic shadows.',
  golden_hour: 'Warm golden hour lighting with long soft shadows.',
  por_do_sol: 'Dramatic sunset lighting with warm orange and pink tones.',
  noturna: 'Night time lighting with warm artificial glow.',
  nublado: 'Soft overcast daylight, diffuse even lighting.',
  quente: 'Warm, inviting indirect lighting.',
};

const CAMERA_CLAUSES_NO_IMAGE: Partial<Record<IdeaCamera, string>> = {
  frontal: 'Frontal, symmetrical framing.',
  perspectiva: 'Architectural perspective view with natural depth.',
  grande_angular: 'Wide-angle framing that captures the full space.',
  aerea: 'Aerial / bird\'s-eye view.',
  detalhe: 'Close, detail-focused framing on materials and finishes.',
};

const CAMERA_PRESERVE_CLAUSE =
  'Keep the exact camera position, angle, perspective and framing from the reference image.';

const ATMOSPHERE_CLAUSES: Partial<Record<IdeaAtmosphere, string>> = {
  aconchegante: 'Warm, cozy atmosphere.',
  sofisticada: 'Sophisticated, refined atmosphere.',
  dramatica: 'Dramatic, high-contrast atmosphere.',
  natural: 'Calm, natural atmosphere.',
  minimalista: 'Quiet, minimalist atmosphere.',
  cinematografica: 'Cinematic atmosphere with strong mood and depth.',
};

const MATERIAL_CLAUSES: Partial<Record<IdeaMaterialPreset, string>> = {
  madeira: 'Emphasize natural wood.',
  pedra_natural: 'Emphasize natural stone.',
  concreto: 'Emphasize concrete.',
  marmore: 'Emphasize marble.',
  tons_neutros: 'Emphasize neutral tones throughout.',
};

const CREATIVITY_CLAUSES: Record<string, string> = {
  baixa: 'Stay close and precise to the brief above.',
  equilibrada: 'Interpret the brief with natural, tasteful architectural detailing where it is not fully specified.',
  alta: 'Feel free to creatively enrich the brief above with tasteful, coherent design details.',
};

// Same concept/wording as Render IA's promptBuilder.ts — standardized across every tool.
const SURROUNDINGS_CLAUSES: Record<EnvironmentOption, string> = {
  preserve_original: 'Keep a background and surrounding environment consistent with the brief.',
  urban: 'Place the scene within a realistic urban context with nearby buildings and streets.',
  residential: 'Place the scene within a realistic residential neighborhood context.',
  tropical: 'Surround the scene with lush tropical vegetation and landscaping.',
  nature: 'Surround the scene with natural landscape, trees and greenery.',
  minimal: 'Use a clean, minimal environment with subtle landscaping and uncluttered surroundings.',
};

// 'automatic' has no fixed clause — it leaves LED strip/accent lighting entirely to the model's own judgment.
const LED_CLAUSES: Partial<Record<LedOption, string>> = {
  off: 'Do not include any LED strip lighting or LED accent lighting in the scene.',
  white: 'Any LED strip or accent lighting in the scene should be cool white (around 6500K).',
  yellow: 'Any LED strip or accent lighting in the scene should be warm yellow (around 3000K).',
};

const QUALITY_CLAUSE =
  'Professional architectural and interior visualization. Realistic, physically plausible materials and textures. Coherent, well-balanced lighting. Correct proportions and scale. This is a concept exploration for design inspiration, not a technical or executive project document.';

export function buildIdeaPrompt(settings: IdeaGeneratorSettings, options: { hasReferenceImage: boolean }): string {
  const parts: string[] = [options.hasReferenceImage ? REIMAGINE_FRAMING : BASE_FRAMING];

  const environmentClause = ENVIRONMENT_CLAUSES[settings.environment];
  if (environmentClause) parts.push(environmentClause);

  if (settings.space.trim()) {
    parts.push(`Space: ${settings.space.trim()}.`);
  }

  const goalClause = GOAL_CLAUSES[settings.goal];
  if (goalClause) parts.push(goalClause);

  const styleClause = STYLE_CLAUSES[settings.style];
  if (styleClause) parts.push(styleClause);

  if (options.hasReferenceImage) {
    parts.push(PRESERVATION_CLAUSES[settings.preservation]);
    parts.push(TRANSFORMATION_CLAUSES[settings.transformation]);
    if (settings.camera === 'preservar') {
      parts.push(CAMERA_PRESERVE_CLAUSE);
    }
  } else {
    const cameraClause = CAMERA_CLAUSES_NO_IMAGE[settings.camera];
    if (cameraClause) parts.push(cameraClause);
  }

  const lightingClause = LIGHTING_CLAUSES[settings.lighting];
  if (lightingClause) parts.push(lightingClause);

  const atmosphereClause = ATMOSPHERE_CLAUSES[settings.atmosphere];
  if (atmosphereClause) parts.push(atmosphereClause);

  const materialClause = MATERIAL_CLAUSES[settings.materials];
  if (materialClause) parts.push(materialClause);

  parts.push(SURROUNDINGS_CLAUSES[settings.surroundings]);

  const ledClause = LED_CLAUSES[settings.led];
  if (ledClause) parts.push(ledClause);

  parts.push(CREATIVITY_CLAUSES[settings.creativity]);

  if (settings.details?.trim()) {
    parts.push(`Additional details from the user: ${settings.details.trim()}`);
  }

  parts.push(QUALITY_CLAUSE);

  return parts.join('\n\n');
}
