import {
  EnvironmentOption,
  LedOption,
  LightingOption,
  PreserveLevel,
  ProjectType,
  RenderSettings,
  RenderStyleOption,
} from '../types/api';

const BASE_PROMPT = `Create a highly photorealistic architectural visualization from the provided reference image.

Preserve the architectural design exactly.

Do not redesign the building.

Preserve the original geometry, proportions, camera position, perspective, floor levels, roof shape, walls, slabs, columns, windows, doors, openings and architectural composition.

Do not add, remove, resize or reposition architectural elements.

The result must represent the same architectural project shown in the reference.

Improve only the visual realism, materials, textures, lighting, reflections, shadows, vegetation and environmental context.

Use physically realistic architectural materials.

Professional architectural photography.

High-end photorealistic architectural visualization.`;

const PRESERVATION_CLAUSES: Record<PreserveLevel, string> = {
  high: 'Architectural preservation priority: maximum. Any deviation from the original structural geometry, proportions or composition is not acceptable. Treat the reference image as an immutable ground truth for form and layout, and change only surface-level realism.',
  medium:
    'Architectural preservation priority: high. Keep the structural geometry and composition intact while allowing natural improvements to materials, lighting and surrounding context.',
  low: "Architectural preservation priority: moderate. Keep the building's overall design clearly recognizable, but allow reasonable creative interpretation of secondary details and surroundings.",
};

const PROJECT_TYPE_CLAUSES: Record<ProjectType, string> = {
  exterior:
    'This is an exterior architectural render. Focus on facade materials, landscaping, sky and outdoor lighting conditions.',
  interior:
    'This is an interior architectural render. Focus on interior finishes, furniture materials, indoor lighting and spatial atmosphere. Preserve the room layout, wall positions and window openings exactly.',
};

// Aesthetic references only — the app never actually runs Corona/V-Ray/Enscape/Lumion.
// 'custom' intentionally has no fixed clause: it hands full aesthetic control to Custom Instructions.
const RENDER_STYLE_CLAUSES: Record<RenderStyleOption, string> = {
  photorealistic:
    'professional architectural photography, physically realistic materials, natural lighting, realistic reflections, realistic vegetation, high dynamic range',
  corona:
    'photorealistic architectural visualization, soft global illumination, realistic materials, natural exposure, subtle contrast, physically realistic lighting, high-end architectural photography',
  vray: 'high-end architectural visualization, physically based materials, realistic reflections, global illumination, sharp material definition, professional archviz photography',
  enscape:
    'clean contemporary architectural visualization, realistic daylight, balanced materials, natural vegetation, modern real-time visualization aesthetic',
  lumion:
    'lush architectural visualization, rich landscaping, atmospheric lighting, vivid environmental details, realistic sky and vegetation',
  minimal_clean:
    'minimalist architectural visualization, clean materials, subtle landscaping, soft neutral lighting, elegant composition, restrained color palette',
  cinematic:
    'cinematic architectural visualization, dramatic but realistic lighting, atmospheric depth, sophisticated color grading, high-end architectural photography',
  custom: '',
};

const LIGHTING_CLAUSES: Record<LightingOption, string> = {
  daylight: 'Bright natural daylight, clear sky, soft realistic shadows.',
  golden_hour: 'Warm golden hour lighting with long soft shadows and a warm color temperature.',
  sunset: 'Dramatic sunset lighting with warm orange and pink tones in the sky and warm reflections.',
  night: 'Night time architectural lighting with artificial lights, warm interior and exterior glow, and a dark sky.',
};

const ENVIRONMENT_CLAUSES: Record<EnvironmentOption, string> = {
  preserve_original: 'Keep the original background and surrounding environment exactly as shown in the reference image.',
  urban: 'Place the building within a realistic urban context with nearby buildings and streets.',
  residential: 'Place the building within a realistic residential neighborhood context.',
  tropical: 'Surround the building with lush tropical vegetation and landscaping.',
  nature: 'Surround the building with natural landscape, trees and greenery.',
  minimal: 'Use a clean, minimal environment with subtle landscaping and uncluttered surroundings.',
};

// 'automatic' has no fixed clause — it leaves LED strip/accent lighting entirely to the model's own judgment.
const LED_CLAUSES: Partial<Record<LedOption, string>> = {
  off: 'Do not include any LED strip lighting or LED accent lighting in the scene.',
  white: 'Any LED strip or accent lighting in the scene should be cool white (around 6500K).',
  yellow: 'Any LED strip or accent lighting in the scene should be warm yellow (around 3000K).',
};

const REFERENCE_RENDER_CLAUSE = `Use IMAGE 1 as the absolute architectural and geometric reference. Preserve its building design, camera position, perspective, openings, proportions and composition.

Use IMAGE 2 only as a visual style reference. Transfer its material language, lighting characteristics, atmosphere, landscaping style, color grading and overall rendering aesthetic to the architecture shown in IMAGE 1.

Do not copy the architecture or geometry from IMAGE 2.`;

const ASPECT_RATIO_CLAUSE =
  'The output canvas may use a different aspect ratio than the reference image. Do not stretch, distort or deform the architecture to fill this canvas. If additional visual area is required to match the new aspect ratio, extend the surrounding environment, sky, ground or landscaping naturally around the unchanged building rather than altering its proportions.';

function buildRenderStyleClause(style: RenderStyleOption, hasReferenceRender: boolean): string | null {
  const clause = RENDER_STYLE_CLAUSES[style];
  if (!clause) return null; // 'custom' — let Custom Instructions drive aesthetics entirely
  if (!hasReferenceRender) return clause;
  // Priority rule: when a Reference Render is present, it leads on aesthetics —
  // the render style is only a secondary, complementary influence.
  return `As a secondary, complementary influence on materials and mood only (IMAGE 2 takes priority for aesthetics): ${clause}`;
}

function buildCustomInstructionsClause(settings: RenderSettings): string | null {
  if (!settings.customInstructions) return null;
  if (settings.preserveArchitecture === 'high') {
    // Never let free-text instructions override HIGH preservation's geometry lock.
    return `Apply the following additional instructions only to materials, lighting, atmosphere and environment — never to the building's geometry, structure or proportions: ${settings.customInstructions}`;
  }
  return `Additional instructions: ${settings.customInstructions}`;
}

/**
 * Centralized builder for the internal FLUX prompt — the single source of truth
 * for prompt construction. Clause order follows the app's priority rules:
 * 1) architecture (base + preservation), 2) reference render aesthetics (if any),
 * 3) render style, 4) lighting/environment/aspect-ratio/custom instructions.
 */
export function buildArchitecturalPrompt(
  settings: RenderSettings,
  options: { hasReferenceRender: boolean }
): string {
  const parts = [BASE_PROMPT, PRESERVATION_CLAUSES[settings.preserveArchitecture]];

  if (options.hasReferenceRender) {
    parts.push(REFERENCE_RENDER_CLAUSE);
  }

  parts.push(PROJECT_TYPE_CLAUSES[settings.projectType]);

  const styleClause = buildRenderStyleClause(settings.renderStyle, options.hasReferenceRender);
  if (styleClause) parts.push(styleClause);

  parts.push(LIGHTING_CLAUSES[settings.lighting], ENVIRONMENT_CLAUSES[settings.environment]);

  const ledClause = LED_CLAUSES[settings.led];
  if (ledClause) parts.push(ledClause);

  if (settings.aspectRatio !== 'automatic') {
    parts.push(ASPECT_RATIO_CLAUSE);
  }

  const customClause = buildCustomInstructionsClause(settings);
  if (customClause) parts.push(customClause);

  return parts.join('\n\n');
}
