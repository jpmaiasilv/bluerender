import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { getStripe, isStripeConfigured } from '../lib/stripe';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from '../lib/supabaseAdmin';
import { isBillingInterval, isBillingPlanId } from '../config/billingPlans';
import { serverLogger } from '../lib/logger';

/**
 * Mounted separately from the rest of the API in index.ts, with express.raw()
 * instead of express.json() — Stripe's signature check needs the exact raw
 * request body bytes, which a JSON-parsed body can no longer provide.
 */
export const billingWebhookRouter = Router();

billingWebhookRouter.post('/billing/webhook', async (req: Request, res: Response) => {
  if (!isStripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    serverLogger.error('Received Stripe webhook but STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET are not configured.');
    res.status(503).send('Webhook not configured.');
    return;
  }

  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string') {
    res.status(400).send('Missing Stripe-Signature header.');
    return;
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(req.body as Buffer, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    serverLogger.error('Stripe webhook signature verification failed', err);
    res.status(400).send('Invalid signature.');
    return;
  }

  if (!isSupabaseAdminConfigured()) {
    serverLogger.error('Stripe webhook received but Supabase admin is not configured — cannot persist subscription state.');
    res.status(200).json({ received: true });
    return;
  }

  try {
    await handleEvent(event);
    res.status(200).json({ received: true });
  } catch (err) {
    serverLogger.error(`Failed to process Stripe webhook event ${event.type}`, err);
    res.status(500).json({ error: { code: 'WEBHOOK_PROCESSING_FAILED' } });
  }
});

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== 'subscription' || !session.subscription) return;
      const organizationId = session.metadata?.organization_id;
      if (!organizationId) {
        serverLogger.error(`checkout.session.completed ${session.id} is missing organization_id metadata`);
        return;
      }
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
      const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
      await upsertSubscription(organizationId, subscription, session.metadata);
      return;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const organizationId = subscription.metadata?.organization_id;
      if (!organizationId) {
        serverLogger.error(`${event.type} ${subscription.id} is missing organization_id metadata`);
        return;
      }
      await upsertSubscription(organizationId, subscription, subscription.metadata);
      return;
    }
    default:
      return;
  }
}

function mapStripeStatus(status: Stripe.Subscription.Status): string {
  switch (status) {
    case 'trialing':
    case 'active':
    case 'past_due':
    case 'canceled':
    case 'unpaid':
      return status;
    default:
      // incomplete / incomplete_expired / paused — no local status covers these
      // sub-states yet; treat as inactive until the subscription reaches one
      // of the states above.
      return 'inactive';
  }
}

async function upsertSubscription(
  organizationId: string,
  subscription: Stripe.Subscription,
  metadata: Stripe.Metadata | null | undefined
): Promise<void> {
  const plan = isBillingPlanId(metadata?.plan) ? metadata!.plan : null;
  const interval = isBillingInterval(metadata?.interval) ? metadata!.interval : null;
  // Billing periods live on each subscription item (not the subscription
  // itself) as of the Stripe API version this SDK targets — see lib/stripe.ts.
  const periodEndSeconds = subscription.items.data[0]?.current_period_end;
  const currentPeriodEnd = periodEndSeconds ? new Date(periodEndSeconds * 1000).toISOString() : null;
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

  const { error } = await getSupabaseAdmin()
    .from('organization_subscriptions')
    .upsert(
      {
        organization_id: organizationId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
        plan,
        billing_interval: interval,
        status: mapStripeStatus(subscription.status),
        current_period_end: currentPeriodEnd,
      },
      { onConflict: 'organization_id' }
    );

  if (error) {
    serverLogger.error('Failed to upsert organization_subscriptions from webhook', error);
    throw error;
  }
}
