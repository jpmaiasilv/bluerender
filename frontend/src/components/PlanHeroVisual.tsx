import { PlanDefinition } from '../config/plans';
import { useLanguage } from '../i18n';
import heroBannerSrc from '../assets/plan-hero-banner.png';

interface Props {
  plan: PlanDefinition;
}

/**
 * "Sketch -> photoreal render" banner image, shared across all three plans.
 * Chips overlay the panel with a short, plan-specific value summary.
 */
export function PlanHeroVisual({ plan }: Props) {
  const { messages } = useLanguage();

  const chips = [
    messages.plans.creditsChip(plan.monthlyCredits),
    plan.maxResolution,
    ...messages.plans.heroChipsExtra[plan.id],
  ];

  return (
    <div className="relative h-32 overflow-hidden rounded-xl border border-border bg-gradient-to-br from-sapphire-soft to-sapphire-light">
      <img src={heroBannerSrc} alt="" className="absolute inset-0 h-full w-full object-cover" aria-hidden="true" />

      <div className="absolute inset-x-2 bottom-2 flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <span
            key={chip}
            className="rounded-full bg-surface/90 px-2 py-1 text-[11px] font-medium text-ink shadow-card backdrop-blur-sm"
          >
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}
