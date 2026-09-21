/**
 * Configuration of the premium (Astra) mode of Planta Humanizada. Astra only
 * ANALYZES the original plan to improve the prompt; nothing here (or anywhere
 * in the pipeline) scores, approves or rejects a generated image.
 */

/** The mode is OFF unless the flag is exactly the string "true". */
export function isAstraFlagEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HUMANIZED_FLOORPLAN_ASTRA_ENABLED === 'true';
}

/** Hard ceiling for the whole premium pipeline (one analysis + one generation): it must finish (or fail and refund) well before the wallet's stale-reservation window. */
export const ASTRA_PIPELINE_MAX_MS = Number(process.env.HUMANIZED_FLOORPLAN_ASTRA_PIPELINE_MAX_MS) || 12 * 60 * 1000;

/** Sanitized-text limits for anything model-written that is stored or placed into a later prompt. */
export const ASTRA_MAX_LIST_ITEMS = 40;
export const ASTRA_MAX_ITEM_CHARS = 240;
export const ASTRA_MAX_PROMPT_CHARS = 1200;
