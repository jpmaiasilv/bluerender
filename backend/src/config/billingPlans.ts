/**
 * Maps a commercial plan + billing interval to the Stripe Price ID env var that
 * holds it. Mirrors frontend/src/config/plans.ts's PlanId ('starter'|'pro'|'studio') —
 * `interval` uses 'monthly'|'yearly' to match the STRIPE_PRICE_*_MONTHLY/YEARLY
 * env var names already set in backend/.env (frontend's BillingCycle says 'annual';
 * that's translated to 'yearly' at the call site, not renamed here).
 */

export type BillingPlanId = 'starter' | 'pro' | 'studio';
export type BillingInterval = 'monthly' | 'yearly';

const PRICE_ENV_VARS: Record<BillingPlanId, Record<BillingInterval, string>> = {
  starter: { monthly: 'STRIPE_PRICE_STARTER_MONTHLY', yearly: 'STRIPE_PRICE_STARTER_YEARLY' },
  pro: { monthly: 'STRIPE_PRICE_PRO_MONTHLY', yearly: 'STRIPE_PRICE_PRO_YEARLY' },
  studio: { monthly: 'STRIPE_PRICE_STUDIO_MONTHLY', yearly: 'STRIPE_PRICE_STUDIO_YEARLY' },
};

export function isBillingPlanId(value: unknown): value is BillingPlanId {
  return value === 'starter' || value === 'pro' || value === 'studio';
}

export function isBillingInterval(value: unknown): value is BillingInterval {
  return value === 'monthly' || value === 'yearly';
}

/** Returns null (never a guessed/invented id) if the matching env var isn't set. */
export function getPriceId(plan: BillingPlanId, interval: BillingInterval): string | null {
  const envVar = PRICE_ENV_VARS[plan][interval];
  return process.env[envVar] || null;
}
