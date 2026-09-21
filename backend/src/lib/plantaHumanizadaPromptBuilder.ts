import { PlantaHumanizadaSettings, PlantaRenderStyle } from '../types/plantaHumanizada';

/**
 * Centralized builder for Planta Humanizada's FLUX prompt. Kept deliberately
 * separate from promptBuilder.ts (Render IA) and the other tools' builders —
 * same isolation rationale as those.
 *
 * CRITICAL BUSINESS RULE: unlike Render IA (where preservation is a user-
 * adjustable low/medium/high dial), floor-plan geometry preservation here is
 * NEVER adjustable and NEVER negotiable — the AI may only change the visual
 * treatment/style, never wall positions, door/window openings, room layout or
 * proportions. BASE_PROMPT below is always included in full, and
 * buildCustomInstructionsClause wraps any free-text input so it can only ever
 * affect materials/rendering style, exactly like Render IA's own HIGH-
 * preservation wrapper (see promptBuilder.ts) — just without a lower setting
 * to fall back to.
 *
 * FLUX.2's image-to-image API has no strength/denoising or ControlNet-style
 * structural-conditioning parameter to lock geometry mechanically (confirmed
 * against BFL's own docs — Canny/Depth were deprecated, never available for
 * FLUX.2) — the ONLY lever available is the prompt itself. BFL's own
 * best-practices guidance is to explicitly state everything that must stay
 * unchanged; BASE_PROMPT's furniture/empty-area clauses below exist because
 * omitting them (protecting only walls/doors/windows, never furniture) was
 * the actual root cause of furniture drifting and objects being invented in
 * empty space in earlier testing.
 */

const BASE_PROMPT = `Transform this technical floor plan into a humanized, professionally styled floor plan visualization.

Preserve the exact floor plan geometry: wall positions, wall thickness, door and window openings, room boundaries, room layout, proportions and scale must remain 100% identical to the input.

Do not add, remove, resize, move or reshape any wall, door, window, room or architectural element.

Do not invent rooms, walls or openings that are not present in the input.

Every furniture block and fixture already drawn in the input (bed, sofa, table, chairs, toilet, sink, cabinet, wardrobe, kitchen counter, appliances, etc.) must keep its exact position, orientation and proportions from the input. Only its visual appearance — material, texture, color, style — may change. Do not move, rotate, resize, duplicate, remove or replace any existing furniture block.

Do not add any new furniture, object, fixture, plant, decoration or person that is not already present in the input. Any area shown empty in the input (open floor space, empty walls) must remain empty and unfurnished in the output — do not invent or place new objects there.

Do not change the overall composition, orientation or camera angle — this is a top-down floor plan and must remain a top-down floor plan.

Only improve the visual treatment: materials, colors, textures, shadows, labels and overall presentation quality of the geometry and furniture that already exist in the input.

Professional architectural floor plan presentation, suitable for client delivery.`;

const STYLE_CLAUSES: Record<PlantaRenderStyle, string> = {
  '3d_realista':
    'Render style: humanized 3D floor plan with realistic materials, furniture, textures, soft shadows and a warm, professional presentation look — similar to a top-down architectural visualization.',
  ilustracao:
    'Render style: illustrated floor plan with a hand-drawn/artistic quality, soft flat colors, clean linework and a warm, editorial illustration feel.',
  '2d_tecnico':
    'Render style: clean 2D technical floor plan presentation with clear line weights, subtle fills for rooms and furniture, in the style of a professional architectural drawing.',
  preto_branco:
    'Render style: black and white floor plan presentation, grayscale tones only, clean linework, no color, high contrast between walls and open space.',
  azul_branco:
    'Render style: blue and white floor plan presentation (blueprint aesthetic), blue linework and fills on a white/light background, no other colors.',
  tons_marrom:
    'Render style: warm brown and beige tonal palette throughout the floor plan, wood-like warm neutral tones, no other colors.',
};

function buildCustomInstructionsClause(settings: PlantaHumanizadaSettings): string | null {
  if (!settings.customInstructions) return null;
  // Never let free-text instructions override the geometry lock above — same
  // wrapping pattern as Render IA's HIGH-preservation custom instructions.
  return `Apply the following additional instructions only to materials, colors, furniture, labels and visual style — never to the floor plan's geometry, walls, openings or layout: ${settings.customInstructions}`;
}

export function buildPlantaHumanizadaPrompt(settings: PlantaHumanizadaSettings): string {
  const parts = [BASE_PROMPT, STYLE_CLAUSES[settings.renderStyle]];

  const customClause = buildCustomInstructionsClause(settings);
  if (customClause) parts.push(customClause);

  return parts.join('\n\n');
}

/**
 * "Limpeza Técnica" — a targeted cleanup pass over an ALREADY generated
 * humanized render (not the original technical plan), run through the same
 * image-to-image call as the main generation. There is no masking/inpainting
 * primitive in this backend yet (see providers/bfl.ts — plain whole-image
 * input_image only), so this works by re-describing the same image with an
 * explicit instruction to erase leftover technical markup and otherwise
 * change nothing else at all — the strictest possible preservation clause,
 * even stricter than BASE_PROMPT's, since literally nothing about the
 * rendered style/materials/furniture should shift here.
 */
export function buildPlantaCleanupPrompt(): string {
  return [
    'This is an already humanized/rendered floor plan image. Do not restyle, re-render or change anything about its visual style, materials, colors, furniture, lighting or composition.',
    'Remove ONLY the following leftover technical markup from the image: dimension lines and measurement marks (numeric distances such as "320", "480", "420"), room/unit numbering labels, and any embedded text, letters or area labels (e.g. "área", "A: 13,00 m²").',
    'After removing this markup, fill the erased areas naturally and seamlessly with whatever surface or background was behind them (floor, wall, furniture), so no gaps, blank patches or artifacts remain.',
    'Do not move, add, remove or resize any wall, door, window, room, furniture piece or any other visual element. This is a cleanup-only pass, not a redesign.',
  ].join('\n\n');
}
