import { CheckCircle2 } from 'lucide-react';
import { annualMonthlyEquivalent, BillingCycle, PlanDefinition } from '../config/plans';
import { formatBRL } from '../lib/currency';
import { useLanguage } from '../i18n';

interface Props {
  plan: PlanDefinition;
  cycle: BillingCycle;
  selected: boolean;
  onSelect: () => void;
}

/** Compact, selectable plan row for the modal's left column — no feature list, just enough to decide. */
export function PlanMiniCard({ plan, cycle, selected, onSelect }: Props) {
  const { messages } = useLanguage();
  const displayedMonthly = cycle === 'monthly' ? plan.pricing.BRL.monthlyPrice : annualMonthlyEquivalent(plan);
  const billingLine =
    cycle === 'monthly' ? messages.plans.monthlyBilling : messages.plans.billedAnnually(formatBRL(plan.pricing.BRL.annualPrice));

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-xl border p-4 text-left transition ${
        selected ? 'border-sapphire bg-sapphire-soft' : 'border-border bg-surface hover:border-sapphire/30'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-ink">{messages.plans.names[plan.id]}</span>
        <div className="flex items-center gap-2">
          {plan.recommended && (
            <span className="whitespace-nowrap rounded-full bg-sapphire px-2 py-0.5 text-[10px] font-semibold text-white">
              {messages.plans.mostPopular}
            </span>
          )}
          <CheckCircle2 size={17} className={selected ? 'text-sapphire' : 'text-border'} />
        </div>
      </div>

      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-xl font-bold text-ink">{formatBRL(displayedMonthly)}</span>
        <span className="text-xs text-ink-muted">{messages.plans.perMonth}</span>
      </div>
      <p className="mt-0.5 text-xs font-medium text-sapphire">{messages.plans.creditsPerMonth(plan.monthlyCredits)}</p>
      <p className="mt-1 text-xs text-ink-muted">{billingLine}</p>
    </button>
  );
}
