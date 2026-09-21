import { EngineTier, getEngineConfig } from './engines';

export type PlantaEngineTier = 'fast' | 'pro' | 'ultra';

export interface PlantaEngineOption {
  id: PlantaEngineTier;
  providerId: string;
  modelId: string;
  technicalName: string;
  credits: number;
  recommended: boolean;
}

/**
 * Planta Humanizada uses its own commercial tier names (Fast/Pro/Ultra), same
 * pattern as Imagem por Texto / Gerador de Ideias — see those config files'
 * own comments. Maps onto the exact same three real models/credit costs
 * already defined in config/engines.ts; nothing here duplicates a price or a
 * model id, this is only a relabeling layer. Change pricing in
 * config/engines.ts only.
 */
const TIER_TO_RENDER_ENGINE: Record<PlantaEngineTier, EngineTier> = {
  fast: 'fast',
  pro: 'standard',
  ultra: 'pro',
};

const RECOMMENDED_TIER: PlantaEngineTier = 'pro';

/**
 * Fixed cost for "Limpeza Técnica" (see routes/plantaHumanizada.ts's /cleanup
 * endpoint) — deliberately NOT tied to the engine tier the original
 * generation used. It's a lighter, cheaper follow-up action on an
 * already-generated image, always run on the cheapest ('fast') underlying
 * model regardless of which tier produced the original render.
 */
export const PLANTA_CLEANUP_CREDITS = 1;

export function isPlantaEngineTier(value: string): value is PlantaEngineTier {
  return value === 'fast' || value === 'pro' || value === 'ultra';
}

export function getPlantaEngineOption(tier: string): PlantaEngineOption | undefined {
  if (!isPlantaEngineTier(tier)) return undefined;
  const engine = getEngineConfig(TIER_TO_RENDER_ENGINE[tier]);
  if (!engine) return undefined;
  return {
    id: tier,
    providerId: engine.providerId,
    modelId: engine.modelId,
    technicalName: engine.technicalName,
    credits: engine.credits,
    recommended: tier === RECOMMENDED_TIER,
  };
}

export function listPlantaEngineOptions(): PlantaEngineOption[] {
  return (['fast', 'pro', 'ultra'] as PlantaEngineTier[]).map((tier) => getPlantaEngineOption(tier)!);
}
