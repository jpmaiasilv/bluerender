export type PlanId = 'starter' | 'pro' | 'studio';
export type BillingCycle = 'monthly' | 'annual';
export type PlanPriority = 'normal' | 'high' | 'highest';
export type MaxResolution = '2K' | '4K';

/**
 * Commercial engine tiers shown to customers on the pricing page — intentionally
 * separate from the internal `EngineTier` ('fast'|'standard'|'pro') that Render IA's
 * engine selector already uses to call BFL. This lets marketing talk about
 * Fast/Pro/Ultra, and lets us swap the underlying provider/model per tier later,
 * without the pricing page or Render IA's generation flow depending on each other.
 */
export type CommercialEngineTier = 'fast' | 'pro' | 'ultra';

/** Every benefit line item a plan can list. Display text lives in i18n (messages.plans.features), not here. */
export type PlanFeatureKey =
  | 'renderIA'
  | 'plantaHumanizada'
  | 'imagemPorTexto'
  | 'upscale'
  | 'upscaleAdvanced'
  | 'videoIaCompatible'
  | 'videoIa'
  | 'videoIaAdvanced'
  | 'multiangulo'
  | 'melhorarRender'
  | 'resolution2k'
  | 'resolution4kPro'
  | 'resolution4kStudio'
  | 'commercialUse'
  | 'oneUser'
  | 'threeUsers'
  | 'allStarter'
  | 'allPro'
  | 'proEngines'
  | 'bestEngines'
  | 'renderUltra'
  | 'priorityProcessing'
  | 'highestPriority'
  | 'earlyAccess'
  | 'premiumTools';

export interface PlanFeature {
  key: PlanFeatureKey;
  /** Not implemented yet — UI must show this as "coming soon", never as if it already works. */
  future?: boolean;
}

export interface PlanPricingBRL {
  monthlyPrice: number;
  /** Total charged once, up front, for the whole year. */
  annualPrice: number;
}

export interface PlanDefinition {
  id: PlanId;
  monthlyCredits: number;
  maxResolution: MaxResolution;
  priority: PlanPriority;
  users: number;
  /** True only once multi-seat access is actually implemented (see `users` + the 'threeUsers' feature's `future` flag). */
  multiUserImplemented: boolean;
  recommended: boolean;
  availableEngineTiers: CommercialEngineTier[];
  features: PlanFeature[];
  /**
   * Prices by currency. Only BRL is populated for now — USD/EUR are prepared as
   * empty slots so region-specific commercial prices can be added later without
   * touching every consumer of this config. No automatic FX conversion is done.
   */
  pricing: { BRL: PlanPricingBRL };
}

/**
 * Single source of truth for subscription plans — pricing, credits, resolution,
 * priority, engine-tier access and feature lists. The pricing page, the plan
 * comparison table and any future component all read from this file. Change a
 * price or a credit amount here and it updates everywhere.
 *
 * Annual credits: the annual plan still grants `monthlyCredits` PER MONTHLY
 * CYCLE, not the full year up front — see the credits dropdown / plan comparison
 * copy. That renewal logic is NOT implemented in the backend yet (see routes/wallet.ts);
 * this config only prepares the numbers for when it is.
 */
export const PLANS: PlanDefinition[] = [
  {
    id: 'starter',
    monthlyCredits: 600,
    maxResolution: '2K',
    priority: 'normal',
    users: 1,
    multiUserImplemented: false,
    recommended: false,
    availableEngineTiers: ['fast'],
    pricing: { BRL: { monthlyPrice: 49.9, annualPrice: 499 } },
    features: [
      { key: 'renderIA' },
      { key: 'plantaHumanizada' },
      { key: 'imagemPorTexto' },
      { key: 'upscale' },
      { key: 'videoIaCompatible' },
      { key: 'resolution2k' },
      { key: 'commercialUse' },
      { key: 'oneUser' },
    ],
  },
  {
    id: 'pro',
    monthlyCredits: 2000,
    maxResolution: '4K',
    priority: 'high',
    users: 1,
    multiUserImplemented: false,
    recommended: true,
    availableEngineTiers: ['fast', 'pro'],
    pricing: { BRL: { monthlyPrice: 119.9, annualPrice: 1199 } },
    features: [
      { key: 'allStarter' },
      { key: 'resolution4kPro' },
      { key: 'plantaHumanizada' },
      { key: 'imagemPorTexto' },
      { key: 'videoIa' },
      { key: 'multiangulo' },
      { key: 'melhorarRender' },
      { key: 'upscaleAdvanced' },
      { key: 'proEngines' },
      { key: 'priorityProcessing' },
      { key: 'earlyAccess' },
      { key: 'commercialUse' },
      { key: 'oneUser' },
    ],
  },
  {
    id: 'studio',
    monthlyCredits: 7000,
    maxResolution: '4K',
    priority: 'highest',
    users: 3,
    multiUserImplemented: false,
    recommended: false,
    availableEngineTiers: ['fast', 'pro', 'ultra'],
    pricing: { BRL: { monthlyPrice: 349.9, annualPrice: 3499 } },
    features: [
      { key: 'allPro' },
      { key: 'resolution4kStudio' },
      { key: 'bestEngines' },
      { key: 'renderUltra', future: true },
      { key: 'videoIaAdvanced', future: true },
      { key: 'premiumTools' },
      { key: 'highestPriority' },
      { key: 'earlyAccess' },
      { key: 'commercialUse' },
      { key: 'threeUsers', future: true },
    ],
  },
];

export function getPlan(id: PlanId): PlanDefinition {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`Unknown plan: ${id}`);
  return plan;
}

/** Equivalent monthly price when paying annually up front. */
export function annualMonthlyEquivalent(plan: PlanDefinition): number {
  return plan.pricing.BRL.annualPrice / 12;
}

/** How much cheaper the annual plan is versus paying `monthlyPrice` for 12 months. */
export function annualSavings(plan: PlanDefinition): number {
  return plan.pricing.BRL.monthlyPrice * 12 - plan.pricing.BRL.annualPrice;
}

/**
 * Marketing-only constant for the "até N renders Fast" capacity line shown on
 * the plans/Upgrade UI. This mirrors Render IA's real Fast cost, which is the
 * actual billing authority and lives in backend/src/config/engines.ts (`fast.credits`)
 * — nothing here charges a wallet, so it's safe to state as a separate, documented
 * constant rather than fetching it, but if that backend value ever changes this
 * one must be updated to match.
 */
const FAST_TIER_CREDIT_COST = 2;

/** "Up to N renders" if 100% of the plan's monthly credits were spent on Render Fast only. Always communicate this as an upper bound ("até"), never a guarantee. */
export function fastRenderCapacity(plan: PlanDefinition): number {
  return Math.floor(plan.monthlyCredits / FAST_TIER_CREDIT_COST);
}

/**
 * Future one-off top-up packs (see plans page's credits dropdown). Not purchasable
 * yet — no pricing has been decided, so `price` is intentionally left unset rather
 * than invented. Extras may get different renewal/expiry rules than subscription
 * credits once implemented; that rule also isn't decided yet.
 */
export interface CreditPackDefinition {
  id: string;
  credits: number;
}

export const CREDIT_PACKS: CreditPackDefinition[] = [
  { id: 'pack_50', credits: 50 },
  { id: 'pack_150', credits: 150 },
  { id: 'pack_500', credits: 500 },
];
