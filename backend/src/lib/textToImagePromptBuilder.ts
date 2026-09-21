import { T2ICreativity, T2ILighting, T2IProjectType, T2IStyle, TextToImageSettings } from '../types/textToImage';
import { EnvironmentOption, LedOption } from '../types/api';

/**
 * Centralized builder for Imagem por Texto's FLUX prompt — mirrors the pattern
 * established by promptBuilder.ts for Render IA, but this is a deliberately
 * separate file/function: the two tools have different inputs (no source image
 * here) and must never share mutable prompt-construction state. The user's own
 * written description always leads and is never rewritten or overridden — every
 * clause below only adds context around it.
 */

const QUALITY_CLAUSE =
  'Professional architectural visualization. Realistic, physically plausible materials and textures. Coherent, well-balanced natural or artificial lighting. Correct architectural proportions and scale. Clean, well-composed framing in the style of professional architectural photography. Coherent furniture, landscaping and surrounding context appropriate to the scene. This is a conceptual design visualization for exploration and inspiration, not a technical or executive project document — precise measurements, structural accuracy and construction-grade detail are not required.';

const PROJECT_TYPE_CLAUSES: Partial<Record<T2IProjectType, string>> = {
  exterior: 'This is an exterior architectural scene. Emphasize facade materials, landscaping, sky and outdoor lighting conditions.',
  interior: 'This is an interior architectural scene. Emphasize interior finishes, furniture, spatial layout and indoor lighting atmosphere.',
  paisagismo: 'This is a landscape architecture / garden design scene. Emphasize vegetation, planting design, hardscape materials and outdoor living spaces.',
  comercial: 'This is a commercial architecture scene (retail, hospitality, office or mixed-use). Emphasize signage-free facades, inviting circulation and professional commercial finishes.',
};

const STYLE_CLAUSES: Partial<Record<T2IStyle, string>> = {
  fotorealista: 'Photorealistic rendering style, natural realistic materials, true-to-life lighting and reflections, high dynamic range.',
  contemporaneo: 'Contemporary architecture style: clean lines, large glazing, mixed modern materials, understated elegance.',
  minimalista: 'Minimalist architecture style: restrained geometry, neutral palette, few materials used with great precision, uncluttered composition.',
  tropical: 'Tropical architecture style: natural ventilation, wood and stone materials, lush vegetation, indoor-outdoor integration, warm natural light.',
  luxo: 'Luxury architecture style: premium materials such as natural stone and hardwood, refined detailing, sophisticated lighting, elevated finishes.',
  brutalista: 'Brutalist architecture style: raw exposed concrete, bold monolithic massing, strong geometric shadows, industrial textures.',
  japandi: 'Japandi architecture style: fusion of Japanese and Scandinavian sensibilities, natural light woods, warm minimalism, calm neutral tones, understated craftsmanship.',
};

const LIGHTING_CLAUSES: Partial<Record<T2ILighting, string>> = {
  dia: 'Bright natural daytime lighting, clear sky, soft realistic shadows.',
  manha: 'Soft early morning light, gentle warm tones, long soft shadows, calm atmosphere.',
  golden_hour: 'Warm golden hour lighting with long soft shadows and a warm color temperature.',
  por_do_sol: 'Dramatic sunset lighting with warm orange and pink tones in the sky and warm reflections.',
  noturna: 'Night time lighting with artificial lights, warm interior and exterior glow, and a dark sky.',
  nublado: 'Soft overcast daylight, diffuse even lighting, muted natural tones, no harsh shadows.',
  estudio: 'Clean, evenly lit studio-style presentation lighting, neutral background emphasis on the architecture itself.',
};

// Same concept/wording as Render IA's promptBuilder.ts — standardized across every tool.
const ENVIRONMENT_CLAUSES: Record<EnvironmentOption, string> = {
  preserve_original: 'Keep a background and surrounding environment consistent with the scene described.',
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

const CREATIVITY_CLAUSES: Record<T2ICreativity, string> = {
  baixa: 'Stay close and precise to the written description above. Avoid adding unrequested elements.',
  equilibrada: 'Interpret the written description above with natural, tasteful architectural detailing where it is not fully specified.',
  alta: 'Feel free to creatively enrich the written description above with tasteful, coherent architectural details, materials and atmosphere.',
};

const REFERENCE_IMAGE_CLAUSE =
  'Use the attached reference image only as inspiration for mood, palette, materials and overall aesthetic — do not copy its composition or geometry. Generate a new architectural composition based primarily on the written description above.';

export function buildTextToImagePrompt(
  settings: TextToImageSettings,
  options: { hasReferenceImage: boolean }
): string {
  const parts: string[] = [settings.prompt.trim()];

  const projectTypeClause = PROJECT_TYPE_CLAUSES[settings.projectType];
  if (projectTypeClause) parts.push(projectTypeClause);

  const styleClause = STYLE_CLAUSES[settings.style];
  if (styleClause) parts.push(styleClause);

  const lightingClause = LIGHTING_CLAUSES[settings.lighting];
  if (lightingClause) parts.push(lightingClause);

  parts.push(ENVIRONMENT_CLAUSES[settings.environment]);

  const ledClause = LED_CLAUSES[settings.led];
  if (ledClause) parts.push(ledClause);

  parts.push(CREATIVITY_CLAUSES[settings.creativity]);

  if (options.hasReferenceImage) {
    parts.push(REFERENCE_IMAGE_CLAUSE);
  }

  parts.push(QUALITY_CLAUSE);

  return parts.join('\n\n');
}
