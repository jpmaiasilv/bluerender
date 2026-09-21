import { EngineTier, getEngineConfig } from './engines';
import { OPENAI_BLOCK_IMAGE_MODEL } from './openaiModels';
import { GEMINI_RENDER_MODEL } from '../providers/geminiRenderProvider';

/**
 * Render IA's own engine picker. Deliberately its OWN commercial config, not
 * a bare re-export of config/engines.ts — that file's fast/standard/pro map
 * is shared verbatim by Imagem por Texto, Gerador de Ideias and Planta Editor
 * (see their own *Engines.ts files), so it is never edited to change what
 * Render IA shows. Here an engine is picked by MODEL IDENTITY ("which AI"),
 * not by a speed/quality tier — 'fast', 'gpt_image' and 'nano_banana_2' are
 * the three featured, front-and-center options; 'standard' and 'pro' still
 * work exactly as before (existing history entries keep resolving) but are
 * demoted to the "legacy models" section of the picker, per 2026-09-20
 * decision: real-world testing showed no visible difference between the
 * 2-credit and 10-credit FLUX tiers worth defaulting new users into.
 *
 * The ids of the FLUX tiers are kept EXACTLY as they were ('fast' / 'standard'
 * / 'pro') on purpose — old generation history rows already store one of
 * these three strings as their engine id, and renaming them would orphan
 * that data. 'gpt_image' and 'nano_banana_2' are new.
 */
export type RenderEngineId = EngineTier | 'gpt_image' | 'nano_banana_2';

export interface RenderEngineOption {
  id: RenderEngineId;
  providerId: string;
  modelId: string;
  /** Real underlying model name. Shown in the DEV INFO panel and as the picker's own model name (this app never hides which AI a customer is using). */
  technicalName: string;
  credits: number;
  /** Small badge in the picker, e.g. "Novo" on a newly-added engine. */
  badge?: 'new';
  /** Demoted into the picker's collapsed "legacy models" section instead of the featured list. Still fully selectable/generatable. */
  legacy: boolean;
}

/** Per the 2026-09-20 decision: same price as the other featured engines, so all three compare with no cost difference getting in the way. */
const NEW_ENGINE_CREDITS = 2;

function fromFluxTier(tier: EngineTier, legacy: boolean): RenderEngineOption {
  const e = getEngineConfig(tier)!;
  return { id: tier, providerId: e.providerId, modelId: e.modelId, technicalName: e.technicalName, credits: e.credits, legacy };
}

const RENDER_ENGINES: Record<RenderEngineId, RenderEngineOption> = {
  fast: fromFluxTier('fast', false),
  gpt_image: { id: 'gpt_image', providerId: 'openai', modelId: OPENAI_BLOCK_IMAGE_MODEL, technicalName: 'GPT Image', credits: NEW_ENGINE_CREDITS, badge: 'new', legacy: false },
  nano_banana_2: { id: 'nano_banana_2', providerId: 'gemini', modelId: GEMINI_RENDER_MODEL, technicalName: 'Nano Banana 2', credits: NEW_ENGINE_CREDITS, badge: 'new', legacy: false },
  standard: fromFluxTier('standard', true),
  pro: fromFluxTier('pro', true),
};

/** Featured first, in this fixed order, then the legacy ones. */
const ORDER: RenderEngineId[] = ['fast', 'gpt_image', 'nano_banana_2', 'standard', 'pro'];

export function isRenderEngineId(value: string): value is RenderEngineId {
  return (ORDER as string[]).includes(value);
}

export function getRenderEngineOption(id: string): RenderEngineOption | undefined {
  return isRenderEngineId(id) ? RENDER_ENGINES[id] : undefined;
}

export function listRenderEngineOptions(): RenderEngineOption[] {
  return ORDER.map((id) => RENDER_ENGINES[id]);
}
