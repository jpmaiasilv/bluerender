export type EngineTier = 'fast' | 'standard' | 'pro';

export interface EngineConfig {
  id: EngineTier;
  providerId: string;
  modelId: string;
  /** Real underlying model name. Shown only in this dev MVP's DEV INFO panel —
   * production builds should hide this from end customers. */
  technicalName: string;
  credits: number;
  recommended?: boolean;
}

/**
 * Single source of truth for engine tiers: which provider/model each tier maps to,
 * and how many internal credits a generation costs. Change pricing ONLY here.
 *
 * The frontend reads this via GET /api/engines to render the selector and the
 * "Generate Render · N credits" button — it never invents a cost. The backend
 * re-derives the real cost from this table for every /api/generate request and
 * ignores any cost the client might send, so a tampered request can never pay
 * less than the true price (see routes/generate.ts).
 */
const ENGINES: Record<EngineTier, EngineConfig> = {
  fast: {
    id: 'fast',
    providerId: 'bfl',
    modelId: 'flux-2-klein-4b',
    technicalName: 'FLUX.2 Klein 4B',
    credits: 2,
  },
  standard: {
    id: 'standard',
    providerId: 'bfl',
    modelId: 'flux-2-klein-9b',
    technicalName: 'FLUX.2 Klein 9B',
    credits: 5,
    recommended: true,
  },
  pro: {
    id: 'pro',
    providerId: 'bfl',
    modelId: 'flux-2-pro',
    technicalName: 'FLUX.2 Pro',
    credits: 10,
  },
};

export function isEngineTier(value: string): value is EngineTier {
  return value === 'fast' || value === 'standard' || value === 'pro';
}

export function getEngineConfig(tier: string): EngineConfig | undefined {
  return isEngineTier(tier) ? ENGINES[tier] : undefined;
}

export function listEngines(): EngineConfig[] {
  return [ENGINES.fast, ENGINES.standard, ENGINES.pro];
}
