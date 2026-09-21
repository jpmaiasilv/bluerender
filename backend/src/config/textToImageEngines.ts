import { EngineTier, getEngineConfig } from './engines';
import { OPENAI_BLOCK_IMAGE_MODEL } from './openaiModels';
import { GEMINI_RENDER_MODEL } from '../providers/geminiRenderProvider';

/**
 * Imagem por Texto's own engine picker — same shape and 2026-09-21 redesign
 * as Render IA's config/renderEngines.ts: an engine is picked by MODEL
 * IDENTITY, not a speed/quality tier. 'fast', 'gpt_image' and 'nano_banana_2'
 * are the three featured options; 'pro' and 'ultra' still work exactly as
 * before (existing history keeps resolving) but are demoted to the picker's
 * "legacy models" section.
 *
 * The ids of the FLUX tiers are kept EXACTLY as they were ('fast' / 'pro' /
 * 'ultra') on purpose — old generation history rows already store one of
 * these three strings as their engine id. Only 'gpt_image' and
 * 'nano_banana_2' are new. This tool's own tier-to-FLUX-model mapping
 * (TIER_TO_RENDER_ENGINE) is unchanged and still the only place that reads
 * config/engines.ts — nothing here duplicates a FLUX price or model id.
 */
export type T2IEngineTier = 'fast' | 'pro' | 'ultra' | 'gpt_image' | 'nano_banana_2';

export interface T2IEngineOption {
  id: T2IEngineTier;
  providerId: string;
  modelId: string;
  technicalName: string;
  credits: number;
  /** Small badge in the picker, e.g. "new" on a newly-added engine. */
  badge?: 'new';
  /** Demoted into the picker's collapsed "legacy models" section instead of the featured list. Still fully selectable/generatable. */
  legacy: boolean;
}

const TIER_TO_RENDER_ENGINE: Record<'fast' | 'pro' | 'ultra', EngineTier> = {
  fast: 'fast',
  pro: 'standard',
  ultra: 'pro',
};

/** Per the 2026-09-20 Render IA decision: same price as the featured FLUX tier, so all three compare with no cost difference getting in the way. */
const NEW_ENGINE_CREDITS = 2;

function fromFluxTier(tier: 'fast' | 'pro' | 'ultra', legacy: boolean): T2IEngineOption {
  const e = getEngineConfig(TIER_TO_RENDER_ENGINE[tier])!;
  return { id: tier, providerId: e.providerId, modelId: e.modelId, technicalName: e.technicalName, credits: e.credits, legacy };
}

const ENGINES: Record<T2IEngineTier, T2IEngineOption> = {
  fast: fromFluxTier('fast', false),
  gpt_image: { id: 'gpt_image', providerId: 'openai', modelId: OPENAI_BLOCK_IMAGE_MODEL, technicalName: 'GPT Image', credits: NEW_ENGINE_CREDITS, badge: 'new', legacy: false },
  nano_banana_2: { id: 'nano_banana_2', providerId: 'gemini', modelId: GEMINI_RENDER_MODEL, technicalName: 'Nano Banana 2', credits: NEW_ENGINE_CREDITS, badge: 'new', legacy: false },
  pro: fromFluxTier('pro', true),
  ultra: fromFluxTier('ultra', true),
};

/** Featured first, in this fixed order, then the legacy ones. */
const ORDER: T2IEngineTier[] = ['fast', 'gpt_image', 'nano_banana_2', 'pro', 'ultra'];

export function isT2IEngineTier(value: string): value is T2IEngineTier {
  return (ORDER as string[]).includes(value);
}

export function getT2IEngineOption(tier: string): T2IEngineOption | undefined {
  return isT2IEngineTier(tier) ? ENGINES[tier] : undefined;
}

export function listT2IEngineOptions(): T2IEngineOption[] {
  return ORDER.map((tier) => ENGINES[tier]);
}
