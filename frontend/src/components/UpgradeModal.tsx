import { useState } from 'react';
import { BillingCycle, getPlan, PLANS, PlanId } from '../config/plans';
import { Modal } from './Modal';
import { BillingCycleToggle } from './BillingCycleToggle';
import { PlanMiniCard } from './PlanMiniCard';
import { PlanShowcase } from './PlanShowcase';
import { useLanguage } from '../i18n';
import { useAuth } from '../lib/auth/AuthProvider';
import { CheckoutError, startCheckout } from '../lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
}

const TITLE_ID = 'upgrade-modal-title';

/** frontend's BillingCycle ('monthly'|'annual') -> backend's interval ('monthly'|'yearly'). */
function toBackendInterval(cycle: BillingCycle): 'monthly' | 'yearly' {
  return cycle === 'annual' ? 'yearly' : 'monthly';
}

/**
 * Compact, centered replacement for the old full pricing page. Left column picks
 * a plan + billing cycle; right column sells only the plan currently selected.
 * The CTA starts a real Stripe Checkout session and redirects the browser to it.
 */
export function UpgradeModal({ open, onClose }: Props) {
  const { messages } = useLanguage();
  const { session, currentOrganization } = useAuth();
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [selectedPlanId, setSelectedPlanId] = useState<PlanId>('pro');
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const selectedPlan = getPlan(selectedPlanId);
  const t = messages.plans;

  async function handleCheckout() {
    setCheckoutError(null);

    if (!session?.access_token) {
      setCheckoutError(t.checkoutErrors.generic);
      return;
    }
    if (!currentOrganization) {
      setCheckoutError(t.checkoutErrors.needsOrganization);
      return;
    }

    setSubmitting(true);
    try {
      const url = await startCheckout(currentOrganization.id, selectedPlanId, toBackendInterval(cycle), session.access_token);
      window.location.href = url;
    } catch (err) {
      if (err instanceof CheckoutError) {
        if (err.code === 'FORBIDDEN') setCheckoutError(t.checkoutErrors.forbidden);
        else if (err.code === 'PRICE_NOT_CONFIGURED' || err.code === 'BILLING_NOT_CONFIGURED') setCheckoutError(t.checkoutErrors.notConfigured);
        else setCheckoutError(t.checkoutErrors.generic);
      } else {
        setCheckoutError(t.checkoutErrors.generic);
      }
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy={TITLE_ID} panelClassName="w-[860px] max-w-[calc(100vw-40px)]">
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        {/* Left: plan + cycle selection */}
        <div className="flex flex-col overflow-y-auto border-b border-border p-6 md:w-[45%] md:border-b-0 md:border-r">
          <h2 id={TITLE_ID} className="text-xl font-semibold text-ink">
            {messages.plans.pageTitle}
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">{messages.plans.pageSubtitle}</p>

          <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {messages.plans.selectPlanLabel}
          </p>
          <BillingCycleToggle
            value={cycle}
            onChange={(next) => {
              setCycle(next);
              setCheckoutError(null);
            }}
          />

          <div className="mt-4 flex flex-col gap-3">
            {PLANS.map((plan) => (
              <PlanMiniCard
                key={plan.id}
                plan={plan}
                cycle={cycle}
                selected={plan.id === selectedPlanId}
                onSelect={() => {
                  setSelectedPlanId(plan.id);
                  setCheckoutError(null);
                }}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={handleCheckout}
            disabled={submitting}
            className={`mt-6 w-full rounded-xl py-3.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
              selectedPlan.recommended
                ? 'bg-sapphire text-white shadow-glow hover:bg-sapphire-hover'
                : 'border border-border bg-surface text-ink hover:bg-surface-secondary'
            }`}
          >
            {submitting ? t.ctaRedirecting : t.cta[selectedPlanId]}
          </button>
          {checkoutError && <p className="mt-2 text-sm text-danger">{checkoutError}</p>}
        </div>

        {/* Right: dynamic showcase for the selected plan */}
        <div className="flex-1 overflow-y-auto p-6 md:w-[55%]">
          <PlanShowcase plan={selectedPlan} />
        </div>
      </div>
    </Modal>
  );
}
