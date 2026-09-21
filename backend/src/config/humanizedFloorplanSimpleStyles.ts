/**
 * The 6 initial styles for Planta Humanizada's SIMPLE flow — a fixed,
 * server-validated list (never a free-form string from the client) so the
 * prompt's "Style: X." sentence is always one of these exact English labels,
 * regardless of what language the frontend displays to the user.
 */
export const HUMANIZED_FLOORPLAN_SIMPLE_STYLES = ['contemporaneo', 'minimalista', 'classico', 'tropical', 'industrial', 'escandinavo'] as const;

export type HumanizedFloorplanSimpleStyle = (typeof HUMANIZED_FLOORPLAN_SIMPLE_STYLES)[number];

/** The exact style label inserted into the prompt sent to OpenAI — English, descriptive, independent of the frontend's own display language/translation. */
export const HUMANIZED_FLOORPLAN_SIMPLE_STYLE_LABELS: Record<HumanizedFloorplanSimpleStyle, string> = {
  contemporaneo: 'Contemporary — clean lines, neutral palette, mixed modern materials',
  minimalista: 'Minimalist — sparse furniture, monochrome palette, uncluttered surfaces',
  classico: 'Classic — traditional furniture, warm wood tones, refined symmetrical details',
  tropical: 'Tropical — natural materials, light woods, greenery, airy relaxed atmosphere',
  industrial: 'Industrial — exposed materials, metal and concrete accents, muted tones',
  escandinavo: 'Scandinavian — light woods, soft neutral palette, cozy minimalist furniture',
};

export function isValidHumanizedFloorplanSimpleStyle(value: unknown): value is HumanizedFloorplanSimpleStyle {
  return typeof value === 'string' && (HUMANIZED_FLOORPLAN_SIMPLE_STYLES as readonly string[]).includes(value);
}

// --- Lighting, surroundings, advanced options. Each value list is the single
// server-side source of truth: the route validates against it and the prompt
// builder maps each value to its English prompt phrase.

export const HUMANIZED_FLOORPLAN_LIGHTING_OPTIONS = ['clear_day', 'late_afternoon', 'golden_hour', 'night'] as const;
export type HumanizedFloorplanLighting = (typeof HUMANIZED_FLOORPLAN_LIGHTING_OPTIONS)[number];
export const DEFAULT_HUMANIZED_FLOORPLAN_LIGHTING: HumanizedFloorplanLighting = 'clear_day';

export const HUMANIZED_FLOORPLAN_LIGHTING_PHRASES: Record<HumanizedFloorplanLighting, string> = {
  clear_day: 'bright clear daylight, neutral white balance, soft crisp shadows',
  late_afternoon: 'late-afternoon light, slightly warm tones, longer soft shadows',
  golden_hour: 'golden-hour light, rich warm orange tones, long gentle shadows',
  night: 'night-time presentation, warm interior lighting glowing in each room, deep blue-toned exterior, soft light pools',
};

export const HUMANIZED_FLOORPLAN_SURROUNDINGS_OPTIONS = ['auto', 'none', 'with'] as const;
export type HumanizedFloorplanSurroundings = (typeof HUMANIZED_FLOORPLAN_SURROUNDINGS_OPTIONS)[number];
export const DEFAULT_HUMANIZED_FLOORPLAN_SURROUNDINGS: HumanizedFloorplanSurroundings = 'auto';

export const HUMANIZED_FLOORPLAN_SURROUNDINGS_KINDS = ['lawn', 'forest', 'neighborhood', 'houses', 'custom'] as const;
export type HumanizedFloorplanSurroundingsKind = (typeof HUMANIZED_FLOORPLAN_SURROUNDINGS_KINDS)[number];

export const HUMANIZED_FLOORPLAN_SURROUNDINGS_KIND_PHRASES: Record<Exclude<HumanizedFloorplanSurroundingsKind, 'custom'>, string> = {
  lawn: 'green lawn and tasteful landscaping (grass, shrubs, trees, garden elements) outside the building',
  forest: 'dense forest vegetation surrounding the building from outside, never covering the building itself',
  neighborhood: 'a discreet residential neighborhood setting (streets, sidewalks, lots) outside the building',
  houses: 'neighboring houses or building volumes placed only outside the limits of the floor plan',
};

export const HUMANIZED_FLOORPLAN_TEXT_MODES = ['auto', 'preserve', 'remove'] as const;
export type HumanizedFloorplanTextMode = (typeof HUMANIZED_FLOORPLAN_TEXT_MODES)[number];

export const HUMANIZED_FLOORPLAN_FURNITURE_LEVELS = ['auto', 'essential', 'complete'] as const;
export type HumanizedFloorplanFurnitureLevel = (typeof HUMANIZED_FLOORPLAN_FURNITURE_LEVELS)[number];

export const HUMANIZED_FLOORPLAN_OUTPUT_FORMATS = ['original', 'square', 'landscape', 'portrait'] as const;
export type HumanizedFloorplanOutputFormat = (typeof HUMANIZED_FLOORPLAN_OUTPUT_FORMATS)[number];

/** OpenAI `size` per output format. `original` sends no size at all (the provider default, already proven to work for this model); the three explicit sizes are all documented in the SDK's own size union. */
export const HUMANIZED_FLOORPLAN_OUTPUT_FORMAT_SIZES: Record<HumanizedFloorplanOutputFormat, '1024x1024' | '1536x1024' | '1024x1536' | null> = {
  original: null,
  square: '1024x1024',
  landscape: '1536x1024',
  portrait: '1024x1536',
};

export const MAX_HUMANIZED_FLOORPLAN_CUSTOM_TEXT_CHARS = 2000;
export const MAX_HUMANIZED_FLOORPLAN_CUSTOM_SURROUNDINGS_CHARS = 200;

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}
