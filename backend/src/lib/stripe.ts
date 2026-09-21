import Stripe from 'stripe';

let client: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY must be set in backend/.env to use Stripe from the backend.');
  }
  // Pinned to the version this SDK (stripe@22) was generated against, so the
  // shapes we code against (e.g. billing periods living on subscription items,
  // not the subscription itself) match what the API actually returns.
  client = new Stripe(key, { apiVersion: '2026-08-26.dahlia' });
  return client;
}
