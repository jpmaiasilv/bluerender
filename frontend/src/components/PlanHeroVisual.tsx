import { PlanDefinition } from '../config/plans';
import { useLanguage } from '../i18n';

interface Props {
  plan: PlanDefinition;
}

/**
 * Small original composition suggesting "technical plan -> photoreal render" —
 * built entirely from SVG/gradients (no external or competitor assets), matching
 * the Logo's own geometric language. Chips overlay the panel with a short,
 * plan-specific value summary.
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
      <svg viewBox="0 0 200 90" className="absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden="true">
        {/* "plan" — dashed wireframe */}
        <rect x="14" y="20" width="60" height="50" rx="4" fill="none" stroke="#1769E0" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="4 3" />
        <line x1="24" y1="34" x2="64" y2="34" stroke="#1769E0" strokeOpacity="0.3" strokeWidth="1" />
        <line x1="24" y1="46" x2="64" y2="46" stroke="#1769E0" strokeOpacity="0.3" strokeWidth="1" />
        <line x1="24" y1="58" x2="64" y2="58" stroke="#1769E0" strokeOpacity="0.3" strokeWidth="1" />
        {/* arrow */}
        <path d="M84 45 H112" stroke="#1769E0" strokeWidth="1.5" strokeOpacity="0.6" />
        <path d="M106 39 L114 45 L106 51" stroke="#1769E0" strokeWidth="1.5" strokeOpacity="0.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {/* "render" — solid gradient block */}
        <rect x="126" y="16" width="62" height="58" rx="5" fill="#1769E0" fillOpacity="0.14" />
        <rect x="126" y="16" width="62" height="58" rx="5" fill="none" stroke="#1769E0" strokeOpacity="0.5" strokeWidth="1.5" />
        <path d="M132 58 L150 40 L164 52 L176 34 L182 40 V70 H132 Z" fill="#1769E0" fillOpacity="0.35" />
        <circle cx="172" cy="26" r="5" fill="#1769E0" fillOpacity="0.4" />
      </svg>

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
