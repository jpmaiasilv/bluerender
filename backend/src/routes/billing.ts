import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/requireAuth';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin';
import { getStripe, isStripeConfigured } from '../lib/stripe';
import { getPriceId, isBillingInterval, isBillingPlanId } from '../config/billingPlans';
import { isOrganizationAdmin, isOrganizationMember } from '../lib/organizationMembership';
import { serverLogger } from '../lib/logger';

export const billingRouter = Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

function billingNotConfigured(res: Response): boolean {
  if (!isStripeConfigured() || !isSupabaseAdminConfigured()) {
    res.status(503).json({
      error: {
        code: 'BILLING_NOT_CONFIGURED',
        message: 'Billing is not configured on this server yet (missing STRIPE_SECRET_KEY, SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY).',
      },
    });
    return true;
  }
  return false;
}

/**
 * Starts a hosted Stripe Checkout session for a subscription. The caller's
 * identity comes only from the verified access token (req.user, set by
 * requireAuth) — organizationId is still browser-supplied, so it's checked
 * against real membership before being trusted for anything.
 */
billingRouter.post('/billing/checkout', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (billingNotConfigured(res)) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const { organizationId, plan, interval } = body;

  if (typeof organizationId !== 'string' || !organizationId) {
    res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'organizationId is required.' } });
    return;
  }
  if (!isBillingPlanId(plan)) {
    res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'plan must be one of: starter, pro, studio.' } });
    return;
  }
  if (!isBillingInterval(interval)) {
    res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'interval must be one of: monthly, yearly.' } });
    return;
  }

  const userId = req.user!.id;
  const isAdmin = await isOrganizationAdmin(userId, organizationId);
  if (!isAdmin) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'You must be an owner or admin of this organization to manage billing.' },
    });
    return;
  }

  const priceId = getPriceId(plan, interval);
  if (!priceId) {
    res.status(503).json({
      error: { code: 'PRICE_NOT_CONFIGURED', message: `No Stripe price is configured for ${plan}/${interval} yet.` },
    });
    return;
  }

  const stripe = getStripe();
  const supabase = getSupabaseAdmin();

  const { data: existing } = await supabase
    .from('organization_subscriptions')
    .select('stripe_customer_id')
    .eq('organization_id', organizationId)
    .maybeSingle();

  let customerId = existing?.stripe_customer_id as string | undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: req.user!.email ?? undefined,
      metadata: { organization_id: organizationId, user_id: userId },
    });
    customerId = customer.id;
    const { error: upsertError } = await supabase
      .from('organization_subscriptions')
      .upsert({ organization_id: organizationId, stripe_customer_id: customerId }, { onConflict: 'organization_id' });
    if (upsertError) {
      serverLogger.error('Failed to persist new Stripe customer id', upsertError);
    }
  }

  const metadata = { organization_id: organizationId, user_id: userId, plan, interval };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${FRONTEND_URL}/precos?checkout=success`,
      cancel_url: `${FRONTEND_URL}/precos?checkout=cancel`,
      allow_promotion_codes: true,
      metadata,
      subscription_data: { metadata },
    });
    res.json({ url: session.url });
  } catch (err) {
    serverLogger.error('Failed to create Stripe checkout session', err);
    res.status(502).json({ error: { code: 'STRIPE_ERROR', message: 'Could not create the checkout session.' } });
  }
});

/** Current subscription status for an organization — any member can read it. */
billingRouter.get('/billing/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const organizationId = typeof req.query.organizationId === 'string' ? req.query.organizationId : null;
  if (!organizationId) {
    res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'organizationId query param is required.' } });
    return;
  }

  if (!isSupabaseAdminConfigured()) {
    res.json({ status: 'inactive', plan: null, interval: null, currentPeriodEnd: null });
    return;
  }

  const userId = req.user!.id;
  const isMember = await isOrganizationMember(userId, organizationId);
  if (!isMember) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You are not a member of this organization.' } });
    return;
  }

  const { data, error } = await getSupabaseAdmin()
    .from('organization_subscriptions')
    .select('plan, billing_interval, status, current_period_end')
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) {
    serverLogger.error('Failed to read organization_subscriptions', error);
    res.status(500).json({ error: { code: 'BILLING_STATUS_FAILED', message: 'Could not read billing status.' } });
    return;
  }

  res.json({
    status: data?.status ?? 'inactive',
    plan: data?.plan ?? null,
    interval: data?.billing_interval ?? null,
    currentPeriodEnd: data?.current_period_end ?? null,
  });
});
