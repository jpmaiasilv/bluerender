import { z } from 'zod';
import { ASTRA_MAX_ITEM_CHARS, ASTRA_MAX_LIST_ITEMS, ASTRA_MAX_PROMPT_CHARS } from '../../config/humanizedFloorplanAstra';

/**
 * Structured output of the single Astra call (the architectural analysis). The
 * schema validates FORMAT only. Astra never judges a generated image.
 */

const stringList = { type: 'array', items: { type: 'string' } } as const;

export const ASTRA_ANALYSIS_SCHEMA_NAME = 'astra_architecture_analysis';
export const ASTRA_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['architectural_constraints', 'style_reference', 'generation_guidance'],
  properties: {
    architectural_constraints: {
      type: 'object',
      additionalProperties: false,
      required: ['building_perimeter', 'walls', 'openings', 'doors', 'windows', 'stairs', 'fixed_elements', 'rooms', 'circulation', 'elements_that_must_not_change'],
      properties: {
        building_perimeter: stringList,
        walls: stringList,
        openings: stringList,
        doors: stringList,
        windows: stringList,
        stairs: stringList,
        fixed_elements: stringList,
        rooms: stringList,
        circulation: stringList,
        elements_that_must_not_change: stringList,
      },
    },
    style_reference: {
      type: 'object',
      additionalProperties: false,
      required: ['palette', 'materials', 'textures', 'furniture_style', 'vegetation_style', 'shadow_style', 'graphic_language'],
      properties: {
        palette: stringList,
        materials: stringList,
        textures: stringList,
        furniture_style: stringList,
        vegetation_style: stringList,
        shadow_style: stringList,
        graphic_language: stringList,
      },
    },
    generation_guidance: {
      type: 'object',
      additionalProperties: false,
      required: ['preservation_rules', 'allowed_changes', 'forbidden_changes', 'recommended_prompt'],
      properties: {
        preservation_rules: stringList,
        allowed_changes: stringList,
        forbidden_changes: stringList,
        recommended_prompt: { type: 'string' },
      },
    },
  },
} as const;

const list = z.array(z.string());

export const AstraAnalysisSchema = z.object({
  architectural_constraints: z.object({
    building_perimeter: list, walls: list, openings: list, doors: list, windows: list, stairs: list,
    fixed_elements: list, rooms: list, circulation: list, elements_that_must_not_change: list,
  }),
  style_reference: z.object({
    palette: list, materials: list, textures: list, furniture_style: list, vegetation_style: list, shadow_style: list, graphic_language: list,
  }),
  generation_guidance: z.object({ preservation_rules: list, allowed_changes: list, forbidden_changes: list, recommended_prompt: z.string() }),
});
export type AstraAnalysis = z.infer<typeof AstraAnalysisSchema>;

// --- Sanitizing anything model-written before it is stored or reused in a prompt --------

export function sanitizeText(value: string, max: number = ASTRA_MAX_ITEM_CHARS): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[A-Za-z0-9+/]{80,}={0,2}/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function sanitizeList(items: string[], max: number = ASTRA_MAX_LIST_ITEMS): string[] {
  return items.map((s) => sanitizeText(s)).filter(Boolean).slice(0, max);
}

export function sanitizeAnalysis(a: AstraAnalysis): AstraAnalysis {
  const c = a.architectural_constraints;
  const s = a.style_reference;
  const g = a.generation_guidance;
  return {
    architectural_constraints: {
      building_perimeter: sanitizeList(c.building_perimeter), walls: sanitizeList(c.walls), openings: sanitizeList(c.openings), doors: sanitizeList(c.doors),
      windows: sanitizeList(c.windows), stairs: sanitizeList(c.stairs), fixed_elements: sanitizeList(c.fixed_elements), rooms: sanitizeList(c.rooms),
      circulation: sanitizeList(c.circulation), elements_that_must_not_change: sanitizeList(c.elements_that_must_not_change),
    },
    style_reference: {
      palette: sanitizeList(s.palette), materials: sanitizeList(s.materials), textures: sanitizeList(s.textures), furniture_style: sanitizeList(s.furniture_style),
      vegetation_style: sanitizeList(s.vegetation_style), shadow_style: sanitizeList(s.shadow_style), graphic_language: sanitizeList(s.graphic_language),
    },
    generation_guidance: {
      preservation_rules: sanitizeList(g.preservation_rules), allowed_changes: sanitizeList(g.allowed_changes), forbidden_changes: sanitizeList(g.forbidden_changes),
      recommended_prompt: sanitizeText(g.recommended_prompt, ASTRA_MAX_PROMPT_CHARS),
    },
  };
}
