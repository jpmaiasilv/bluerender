import { EngineTier, getEngineConfig } from './engines';
import { OPENAI_BLOCK_IMAGE_MODEL } from './openaiModels';
import { GEMINI_RENDER_MODEL } from '../providers/geminiRenderProvider';

export type IdeaEngineTier = 'fast' | 'pro' | 'ultra' | 'gpt_image' | 'nano_banana_2';
export type IdeaGenerationMode = 'textToImage' | 'imageToImage';

export interface IdeaEngineOption {
  id: IdeaEngineTier;
  providerId: string;
  modelId: string;
  technicalName: string;
  credits: number;
  /** Small badge in the picker, e.g. "new" on a newly-added engine. */
  badge?: 'new';
  /** Demoted into the picker's collapsed "legacy models" section instead of the featured list. Still fully selectable/generatable. */
  legacy: boolean;
}

/**
 * Idea Generator's own commercial config — deliberately NOT reusing
 * textToImageEngines.ts's map directly, per the explicit request to give this
 * tool its own cost table. Same 2026-09-21 redesign as Render IA and Imagem
 * por Texto: 'fast', 'gpt_image' and 'nano_banana_2' are the three featured
 * options in BOTH modes; 'pro' and 'ultra' are demoted to "legacy models".
 *
 * The FLUX tier ids are kept EXACTLY as they were ('fast' / 'pro' / 'ultra')
 * so old generation history keeps resolving. gpt_image/nano_banana_2 are
 * priced and mapped identically for both modes — the OpenAI/Gemini providers
 * accept an optional image already (see openaiRenderProvider.ts /
 * geminiRenderProvider.ts), so there is no per-mode cost difference to model,
 * same reasoning already documented below for the FLUX tiers.
 */
const TEXT_TO_IMAGE_MAP: Record<'fast' | 'pro' | 'ultra', EngineTier> = {
  fast: 'fast',
  pro: 'standard',
  ultra: 'pro',
};

const IMAGE_TO_IMAGE_MAP: Record<'fast' | 'pro' | 'ultra', EngineTier> = {
  fast: 'fast',
  pro: 'standard',
  ultra: 'pro',
};

/** Per the 2026-09-20 Render IA decision: same price as the featured FLUX tier, so all three compare with no cost difference getting in the way. */
const NEW_ENGINE_CREDITS = 2;

const ORDER: IdeaEngineTier[] = ['fast', 'gpt_image', 'nano_banana_2', 'pro', 'ultra'];

export function isIdeaEngineTier(value: string): value is IdeaEngineTier {
  return (ORDER as string[]).includes(value);
}

export function isIdeaGenerationMode(value: string): value is IdeaGenerationMode {
  return value === 'textToImage' || value === 'imageToImage';
}

function mapFor(mode: IdeaGenerationMode): Record<'fast' | 'pro' | 'ultra', EngineTier> {
  return mode === 'textToImage' ? TEXT_TO_IMAGE_MAP : IMAGE_TO_IMAGE_MAP;
}

function fromFluxTier(mode: IdeaGenerationMode, tier: 'fast' | 'pro' | 'ultra', legacy: boolean): IdeaEngineOption {
  const e = getEngineConfig(mapFor(mode)[tier])!;
  return { id: tier, providerId: e.providerId, modelId: e.modelId, technicalName: e.technicalName, credits: e.credits, legacy };
}

export function getIdeaEngineOption(mode: IdeaGenerationMode, tier: string): IdeaEngineOption | undefined {
  if (!isIdeaEngineTier(tier)) return undefined;
  if (tier === 'gpt_image') return { id: 'gpt_image', providerId: 'openai', modelId: OPENAI_BLOCK_IMAGE_MODEL, technicalName: 'GPT Image', credits: NEW_ENGINE_CREDITS, badge: 'new', legacy: false };
  if (tier === 'nano_banana_2') return { id: 'nano_banana_2', providerId: 'gemini', modelId: GEMINI_RENDER_MODEL, technicalName: 'Nano Banana 2', credits: NEW_ENGINE_CREDITS, badge: 'new', legacy: false };
  return fromFluxTier(mode, tier, tier !== 'fast');
}

export function listIdeaEngineOptions(mode: IdeaGenerationMode): IdeaEngineOption[] {
  return ORDER.map((tier) => getIdeaEngineOption(mode, tier)!);
}
