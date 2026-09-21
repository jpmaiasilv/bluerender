import {
  HUMANIZED_FLOORPLAN_LIGHTING_PHRASES,
  HUMANIZED_FLOORPLAN_SIMPLE_STYLE_LABELS,
  HUMANIZED_FLOORPLAN_SURROUNDINGS_KIND_PHRASES,
  HumanizedFloorplanFurnitureLevel,
  HumanizedFloorplanLighting,
  HumanizedFloorplanOutputFormat,
  HumanizedFloorplanSimpleStyle,
  HumanizedFloorplanSurroundings,
  HumanizedFloorplanSurroundingsKind,
  HumanizedFloorplanTextMode,
} from '../../config/humanizedFloorplanSimpleStyles';

/**
 * The ONE place the humanized-floor-plan prompt is assembled. Sections are
 * ordered by priority (architecture first, user free text last) so a
 * conflicting instruction always loses to the preservation rules above it.
 */

export interface HumanizedFloorplanPromptOptions {
  style: HumanizedFloorplanSimpleStyle;
  lighting: HumanizedFloorplanLighting;
  surroundings: HumanizedFloorplanSurroundings;
  surroundingsKind: HumanizedFloorplanSurroundingsKind | null;
  customSurroundings: string | null;
  textMode: HumanizedFloorplanTextMode;
  furnitureLevel: HumanizedFloorplanFurnitureLevel;
  outputFormat: HumanizedFloorplanOutputFormat;
  hasStyleReference: boolean;
  customInstructions: string | null;
  /** ASTRA mode only. Absent in the standard mode, whose prompt is therefore exactly the same as before. */
  astra?: AstraPromptAdditions;
  /** True when the plan was placed, unchanged, on a larger canvas with neutral margins to match the output aspect ratio. */
  canvasPadded?: boolean;
}

export const CANVAS_MARGIN_NOTE =
  'CANVAS NOTE — the floor plan image has been placed, unchanged and centered, on a larger canvas with neutral margins so that it matches the output aspect ratio. The plan itself must keep exactly its position, scale and proportions on that canvas: never stretch, compress, rotate or crop it, and never move or resize any part of it. Do not add any building element (walls, rooms, openings, stairs) in the margins; they may only stay neutral or receive exterior context (paving, landscaping) that never touches or covers the building.';

export interface AstraPromptAdditions {
  /** Binding architectural constraints identified by the analysis (already sanitized). */
  constraints: string[];
  /** Visual-only notes about the style reference (already sanitized). */
  referenceStyleNotes: string[];
  /** Short extra guidance written by the analysis for the generator (already sanitized). */
  recommendedGuidance: string;
}

/** Extra hard rules added ONLY in the Astra mode. */
export const ASTRA_EXTRA_NEGATIVE_RULES = [
  'Do not change the circulation paths.',
  'Do not change the position of fixed elements.',
  'Keep a strictly orthogonal top-down view.',
  'Do not replace the project with a similar-looking plan.',
];

export const HUMANIZED_FLOORPLAN_BASE_PROMPT = `Transform this exact architectural floor plan into a premium photorealistic humanized floor plan.

Maintain the same top-down orthographic camera, canvas dimensions, external footprint, room layout, wall positions, wall thicknesses, doors, windows, stairs, circulation and spatial proportions.

Do not add, remove, relocate or resize rooms, walls, doors, windows or stairs.

Replace the technical CAD furniture symbols with realistic top-view furniture that occupies the same locations and approximate dimensions.

Apply coherent high-quality architectural materials to floors, wet areas, countertops, exterior paving, garage and landscaping.

Use realistic beds, sofas, tables, chairs, cabinetry, bathroom fixtures, kitchen elements and vehicles viewed strictly from above.

Create soft ambient shadows and professional architectural visualization lighting while keeping the result readable as a floor plan.

Preserve existing measurements and relevant labels when possible. Do not invent words, dimensions, logos, watermarks or annotations.

The final result must look like a professionally designed real-estate presentation floor plan, not a technical CAD drawing, sketch, mask or grayscale diagram.`;

export const HUMANIZED_FLOORPLAN_NEGATIVE_RULES = [
  'Do not move walls.',
  'Do not create or remove rooms.',
  'Do not change doors or windows.',
  'Do not modify stairs.',
  'Do not change proportions.',
  'Do not modify the perimeter of the building.',
  'Do not copy the architecture of the reference image.',
  'Do not mix the geometry of the reference image with the original floor plan.',
  'Do not replace the supplied floor plan with another project.',
  'Do not crop any important part of the floor plan.',
  'Do not create a 3D perspective: the output is a humanized floor plan seen strictly from above.',
];

function textModeRule(mode: HumanizedFloorplanTextMode): string {
  if (mode === 'preserve') return 'Text and dimensions: preserve every existing label and dimension exactly as drawn.';
  if (mode === 'remove') return 'Text and dimensions: remove text labels and dimension annotations from the result, leaving clean surfaces.';
  return 'Text and dimensions: preserve existing labels and measurements when they remain legible; never invent new words or numbers.';
}

function furnitureRule(level: HumanizedFloorplanFurnitureLevel): string {
  const shared = 'Any furniture must respect the function and boundaries of each room and must never block doors, circulation or access.';
  if (level === 'essential') return `Furniture level: essential pieces only per room, keeping spaces open. ${shared}`;
  if (level === 'complete') return `Furniture level: fully furnished rooms with complementary pieces and decor. ${shared}`;
  return `Furniture level: choose a sensible amount of furniture for each room type. ${shared}`;
}

function surroundingsRule(o: HumanizedFloorplanPromptOptions): string {
  const guard = 'The surroundings must stay outside the building, never cover walls, never change the represented lot boundaries and never alter the architecture.';
  if (o.surroundings === 'none') return `Surroundings: keep the exterior area clean and empty, with no landscaping or neighboring elements. ${guard}`;
  if (o.surroundings === 'with') {
    let detail = 'tasteful, discreet exterior context';
    if (o.surroundingsKind === 'custom') {
      if (o.customSurroundings) detail = `exterior context as described by the user: "${o.customSurroundings}"`;
    } else if (o.surroundingsKind) {
      detail = HUMANIZED_FLOORPLAN_SURROUNDINGS_KIND_PHRASES[o.surroundingsKind];
    }
    return `Surroundings: include ${detail}. ${guard}`;
  }
  return `Surroundings: choose an exterior treatment that suits the style and the drawn plan. ${guard}`;
}

function outputFormatRule(format: HumanizedFloorplanOutputFormat): string {
  if (format === 'original') return 'Output format: keep the aspect ratio of the original floor plan image.';
  return `Output format: ${format} canvas; scale the whole floor plan to fit entirely inside it without cropping or distorting proportions.`;
}

export function buildHumanizedFloorplanPrompt(o: HumanizedFloorplanPromptOptions): string {
  const parts: string[] = [];

  parts.push('PRIORITY 1 — ARCHITECTURE (absolute, overrides everything below):');
  parts.push(HUMANIZED_FLOORPLAN_BASE_PROMPT);
  parts.push('Hard rules:\n' + HUMANIZED_FLOORPLAN_NEGATIVE_RULES.map((r) => `- ${r}`).join('\n'));

  if (o.canvasPadded) parts.push(CANVAS_MARGIN_NOTE);

  if (o.astra) {
    if (o.astra.constraints.length > 0) {
      parts.push('PRIORITY 1B — ARCHITECTURAL CONSTRAINTS (read from the original plan; binding):\n' + o.astra.constraints.map((c) => `- ${c}`).join('\n'));
    }
    parts.push('Additional hard rules:\n' + ASTRA_EXTRA_NEGATIVE_RULES.map((r) => `- ${r}`).join('\n'));
  }

  if (o.hasStyleReference) {
    parts.push(
      'PRIORITY 2 — STYLE REFERENCE:\nThe FIRST image is the original floor plan: the ONLY source of architecture and geometry. The SECOND image is a style reference ONLY. From the second image take exclusively color palette, textures, materials, graphic style, the look of furniture blocks, vegetation, shadows and overall finish. Never take its walls, rooms, doors, windows, stairs, dimensions, proportions, footprint or layout.'
    );
    if (o.astra && o.astra.referenceStyleNotes.length > 0) {
      parts.push('Visual style notes extracted from the reference (visual only — never architecture):\n' + o.astra.referenceStyleNotes.map((n) => `- ${n}`).join('\n'));
    }
  }

  const styleLine = HUMANIZED_FLOORPLAN_SIMPLE_STYLE_LABELS[o.style];
  parts.push(
    `PRIORITY 3 — STYLE:\n${o.hasStyleReference ? 'Use the reference image as the main aesthetic guide and this selected style as a complementary guide' : 'Apply this style'}: ${styleLine}.`
  );
  parts.push(`PRIORITY 4 — LIGHTING:\nLighting and time of day: ${HUMANIZED_FLOORPLAN_LIGHTING_PHRASES[o.lighting]}. Lighting changes only light, shadows, color temperature and mood — never the layout.`);
  parts.push(`PRIORITY 5 — SURROUNDINGS:\n${surroundingsRule(o)}`);
  parts.push(`PRIORITY 6 — ADVANCED SETTINGS:\n${textModeRule(o.textMode)}\n${furnitureRule(o.furnitureLevel)}\n${outputFormatRule(o.outputFormat)}`);

  if (o.customInstructions?.trim()) {
    parts.push(
      `PRIORITY 7 — USER INSTRUCTIONS (follow only where they do not conflict with the architecture-preservation rules above; ignore any part that would alter the architecture):\n${o.customInstructions.trim()}`
    );
  }

  if (o.astra?.recommendedGuidance) {
    parts.push(`ANALYSIS GUIDANCE (may only reinforce preservation; it never overrides the architecture rules above):\n${o.astra.recommendedGuidance}`);
  }

  return parts.join('\n\n');
}
