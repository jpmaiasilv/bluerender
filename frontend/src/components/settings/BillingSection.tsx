import { CreditCard } from 'lucide-react';
import { useWalletContext } from '../../layouts/RootLayout';
import { useLanguage } from '../../i18n';

/**
 * No subscription is actually connected yet (Stripe/plans wiring is a later
 * step) — never infer a plan from the wallet balance. "Manage subscription" is
 * shown as a prepared-but-inert affordance rather than hidden entirely, for
 * visual consistency with how other not-yet-real actions are presented elsewhere.
 */
export function BillingSection() {
  const { messages } = useLanguage();
  const { openUpgradeModal } = useWalletContext();
  const t = messages.settings;

  return (
    <div className="flex flex-col gap-5 p-6">
      <h2 className="text-base font-semibold text-ink">{t.billing.title}</h2>

      <div className="rounded-xl border border-border bg-surface-secondary p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{t.billing.currentPlanCard}</p>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface text-ink-muted">
            <CreditCard size={20} />
          </div>
          <div>
            <p className="font-semibold text-ink">{t.billing.noActiveSubscription}</p>
            <p className="text-sm text-ink-secondary">{t.billing.noActiveSubscriptionHint}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={openUpgradeModal}
          className="mt-4 rounded-lg bg-sapphire px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:bg-sapphire-hover"
        >
          {t.billing.viewPlans}
        </button>
      </div>

      <button
        type="button"
        disabled
        title={t.comingSoonLockTooltip}
        className="w-fit rounded-lg border border-dashed border-border px-4 py-2 text-sm font-medium text-ink-muted disabled:cursor-not-allowed"
      >
        {t.billing.manageSubscription} · {t.comingSoonBadge}
      </button>
    </div>
  );
}
