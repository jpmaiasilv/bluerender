import { useState } from 'react';
import { Check, ChevronRight, Info } from 'lucide-react';
import { fastRenderCapacity, PlanDefinition } from '../config/plans';
import { PlanHeroVisual } from './PlanHeroVisual';
import { PlanComparisonTable } from './PlanComparisonTable';
import { useLanguage } from '../i18n';

interface Props {
  plan: PlanDefinition;
}

/** Sells only the currently-selected plan — never all three benefit lists at once. */
export function PlanShowcase({ plan }: Props) {
  const { messages } = useLanguage();
  const [showComparison, setShowComparison] = useState(false);

  return (
    <div key={plan.id} className="flex flex-col gap-4 transition-opacity duration-200">
      <PlanHeroVisual plan={plan} />

      <p className="text-sm font-medium text-ink-secondary">{messages.plans.heroMessage[plan.id]}</p>

      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-ink">{messages.plans.names[plan.id]}</h3>
          {plan.recommended && (
            <span className="rounded-full bg-sapphire px-2 py-0.5 text-[10px] font-semibold text-white">
              {messages.plans.mostPopular}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-ink-secondary">{messages.plans.descriptions[plan.id]}</p>
      </div>

      <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-secondary px-3 py-2.5">
        <p className="text-sm font-medium text-ink">{messages.plans.creditsPerMonth(plan.monthlyCredits)}</p>
        <div className="flex items-center gap-1.5">
          <p className="text-xs text-ink-secondary">{messages.plans.capacityLine(fastRenderCapacity(plan))}</p>
          <span title={messages.plans.capacityTooltip} className="shrink-0 text-ink-muted">
            <Info size={13} aria-hidden="true" />
          </span>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {plan.features.map((feature) => (
          <li key={feature.key} className="flex items-start gap-2 text-sm">
            <Check size={16} className={`mt-0.5 shrink-0 ${feature.future ? 'text-ink-muted' : 'text-sapphire'}`} />
            <span className={feature.future ? 'text-ink-muted' : 'text-ink-secondary'}>
              {messages.plans.features[feature.key]}
              {feature.future && <span className="ml-1 text-xs">({messages.plans.comingSoonSuffix})</span>}
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setShowComparison((v) => !v)}
        className="flex items-center gap-1 self-start text-sm font-medium text-sapphire hover:underline"
      >
        <ChevronRight size={15} className={`transition-transform ${showComparison ? 'rotate-90' : ''}`} />
        {messages.plans.compareLink}
      </button>

      {showComparison && (
        <div className="-mx-1 rounded-lg border border-border p-1">
          <PlanComparisonTable />
        </div>
      )}
    </div>
  );
}
