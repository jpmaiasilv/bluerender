/**
 * Minimal internal event stub for the sales page's conversion funnel. No
 * analytics platform is wired up anywhere in this project yet (checked:
 * no gtag/GA/PostHog/Mixpanel/pixel) — this exists so every section is
 * already instrumented, and adopting a real platform later means swapping
 * the implementation in this one file, not hunting through every section.
 */
export type SalesAnalyticsEvent =
  | 'landing_page_view'
  | 'hero_cta_click'
  | 'before_after_interaction'
  | 'demo_category_selected'
  | 'feature_view'
  | 'pricing_view'
  | 'billing_toggle'
  | 'plan_recommendation_completed'
  | 'plan_selected'
  | 'faq_open'
  | 'final_cta_click';

const firedOnce = new Set<string>();

export function trackEvent(
  event: SalesAnalyticsEvent,
  props?: Record<string, string | number | boolean>,
  options?: { once?: boolean }
): void {
  if (options?.once) {
    if (firedOnce.has(event)) return;
    firedOnce.add(event);
  }
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug('[analytics]', event, props ?? {});
  }
  // TODO: forward to the real analytics platform once one is adopted.
}
