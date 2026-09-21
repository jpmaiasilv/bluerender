import type { LucideIcon } from 'lucide-react';
import { Crown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ToolStatus } from '../config/tools';
import type { PlanId } from '../config/plans';
import { useLanguage } from '../i18n';

interface Props {
  icon: LucideIcon;
  title: string;
  description: string;
  status: ToolStatus;
  requiredPlan?: PlanId;
  to: string;
  /** A real Blue Render asset illustrating the tool — never a live result from that specific tool, just a representative visual. */
  imageSrc: string;
  /** Called instead of navigating when a 'premium' card is clicked. */
  onPremiumClick?: () => void;
}

export function ToolCard({ icon: Icon, title, description, status, requiredPlan, to, imageSrc, onPremiumClick }: Props) {
  const { messages } = useLanguage();
  const isPremium = status === 'premium';
  const premiumTooltip = requiredPlan
    ? messages.nav.premiumTooltip(messages.plans.names[requiredPlan])
    : messages.nav.premiumGenericTooltip;

  return (
    <Link
      to={to}
      onClick={(e) => {
        if (isPremium) {
          e.preventDefault();
          onPremiumClick?.();
        }
      }}
      className="group relative flex flex-col rounded-2xl border border-border bg-surface shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-sapphire/30 hover:shadow-md"
    >
      {/* Image wrapper owns its own clipping (rounded-t-2xl + overflow-hidden)
          instead of the card as a whole — the icon below sits OUTSIDE this
          box, so it's never a descendant of anything that clips it. */}
      <div className="relative h-[104px] w-full shrink-0 overflow-hidden rounded-t-2xl bg-surface-secondary">
        <img
          src={imageSrc}
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="h-full w-full object-cover transition duration-200 ease-out group-hover:scale-[1.02]"
        />
        {status === 'comingSoon' && (
          <span className="absolute right-2.5 top-2.5 rounded-full bg-surface/90 px-2 py-0.5 text-[10px] font-semibold text-ink-muted backdrop-blur-sm">
            {messages.nav.comingSoonBadge}
          </span>
        )}
        {isPremium && (
          <span
            title={premiumTooltip}
            className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-full bg-surface/90 px-2 py-0.5 text-[10px] font-semibold text-premium-gold backdrop-blur-sm"
          >
            <Crown size={11} aria-hidden="true" />
            {messages.nav.premiumBadge}
          </span>
        )}
      </div>

      {/* Straddles the image/content boundary: a normal-flow sibling pulled
          up by half its own height via negative margin, never clipped and
          never part of the image's hover scale/transform. */}
      <div className="relative z-10 -mt-5 ml-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface shadow-card ring-1 ring-border">
        <Icon size={19} className="text-sapphire" strokeWidth={2} />
      </div>

      <div className="flex flex-1 flex-col gap-1 px-4 pb-4 pt-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="line-clamp-2 text-xs leading-snug text-ink-secondary">{description}</p>
      </div>
    </Link>
  );
}
