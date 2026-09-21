import { ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';
import { CommercialEngineTier, PLANS, PlanDefinition, PlanFeatureKey } from '../config/plans';
import { useLanguage } from '../i18n';

function hasFeature(plan: PlanDefinition, key: PlanFeatureKey): boolean {
  return plan.features.some((f) => f.key === key);
}

function Cell({ children }: { children: ReactNode }) {
  return <td className="px-4 py-3 text-center text-sm text-ink-secondary">{children}</td>;
}

function CheckCell({ ok }: { ok: boolean }) {
  return (
    <td className="px-4 py-3 text-center">
      {ok ? <Check size={17} className="mx-auto text-sapphire" /> : <Minus size={15} className="mx-auto text-ink-muted" />}
    </td>
  );
}

/**
 * "Ultra" isn't a real, implemented engine tier anywhere yet (see config/plans.ts) —
 * shown as coming soon for Studio (the only plan that will eventually include it)
 * and as unavailable for the others, never as if it already works.
 */
function EngineTierCell({ plan, tier, comingSoonLabel }: { plan: PlanDefinition; tier: CommercialEngineTier; comingSoonLabel: string }) {
  const included = plan.availableEngineTiers.includes(tier);
  if (tier === 'ultra') {
    return (
      <td className="px-4 py-3 text-center text-xs text-ink-muted">
        {included ? comingSoonLabel : <Minus size={15} className="mx-auto" />}
      </td>
    );
  }
  return <CheckCell ok={included} />;
}

export function PlanComparisonTable() {
  const { messages } = useLanguage();
  const rows = messages.plans.compareRows;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-3 text-left font-medium text-ink-muted"> </th>
            {PLANS.map((plan) => (
              <th key={plan.id} className="px-4 py-3 text-center font-semibold text-ink">
                {messages.plans.names[plan.id]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border">
            <td className="px-4 py-3 text-left text-ink-secondary">{rows.monthlyCredits}</td>
            {PLANS.map((plan) => (
              <Cell key={plan.id}>{plan.monthlyCredits.toLocaleString()}</Cell>
            ))}
          </tr>

          <tr className="border-b border-border">
            <td className="px-4 py-3 text-left text-ink-secondary">{rows.renderIA}</td>
            {PLANS.map((plan) => (
              <CheckCell key={plan.id} ok={hasFeature(plan, 'renderIA') || hasFeature(plan, 'allStarter') || hasFeature(plan, 'allPro')} />
            ))}
          </tr>

          <tr className="border-b border-border">
            <td className="px-4 py-3 text-left text-ink-secondary">{rows.plantaHumanizada}</td>
            {PLANS.map((plan) => (
              <CheckCell key={plan.id} ok={hasFeature(plan, 'plantaHumanizada') || hasFeature(plan, 'allStarter') || hasFeature(plan, 'allPro')} />
            ))}
          </tr>

          <tr className="border-b border-border">
            <td className="px-4 py-3 text-left text-ink-secondary">{rows.imagemPorTexto}</td>
            {PLANS.map((plan) => (
              <CheckCell key={plan.id} ok={hasFeature(plan, 'imagemPorTexto') || hasFeature(plan, 'allStarter') || hasFeature(plan, 'allPro')} />
            ))}
          </tr>

          <tr className="border-b border-border">
            <td className="px-4 py-3 text-left text-ink-secondary">{rows.videoIa}</td>
            {PLANS.map((plan) => (
              <CheckCell key={plan.id} ok={hasFeature(plan, 'videoIa') || hasFeature(plan, 'videoIaCompatible')} />
            ))}
          </tr>

          <tr className="border-b border-border">
            <td className="px-4 py-3 text-left text-ink-secondary">{rows.multiangulo}</td>
            {PLANS.map((plan) => (
              <CheckCell key={plan.id} ok={hasFeature(plan, 'multiangulo') || hasFeature(plan, 'allPro')} />
            ))}
          </tr>

          <tr className="border-b border-border">
            <td className="px-4 py-3 text-left text-ink-secondary">{rows.melhorarRender}</td>
            {PLANS.map((plan) => (
              <CheckCell key={plan.id} ok={hasFeature(plan, 'melhorarRender') || hasFeature(plan, 'allPro')} />
            ))}
          </tr>

          <tr className="border-b border-border">
            <td className="px-4 py-3 text-left text-ink-secondary">{rows.upscale}</td>
            {PLANS.map((plan) => (
              <CheckCell key={plan.id} ok={hasFeature(plan, 'upscale') || hasFeature(plan, 'upscaleAdvanced') || hasFeature(plan, 'allStarter')} />
            ))}
          </tr>

          <tr className="border-b border-border">
            <td className="px-4 py-3 text-left text-ink-secondary">{rows.maxResolution}</td>
            {PLANS.map((plan) => (
              <Cell key={plan.id}>{plan.maxResolution}</Cell>
            ))}
          </tr>

          <tr className="border-b border-border">
            <td className="px-4 py-3 text-left text-ink-secondary">{rows.fast}</td>
            {PLANS.map((plan) => (
              <EngineTierCell key={plan.id} plan={plan} tier="fast" comingSoonLabel={messages.plans.comingSoonCell} />
            ))}
          </tr>
          <tr className="border-b border-border">
            <td className="px-4 py-3 text-left text-ink-secondary">{rows.pro}</td>
            {PLANS.map((plan) => (
              <EngineTierCell key={plan.id} plan={plan} tier="pro" comingSoonLabel={messages.plans.comingSoonCell} />
            ))}
          </tr>
          <tr className="border-b border-border">
            <td className="px-4 py-3 text-left text-ink-secondary">{rows.ultra}</td>
            {PLANS.map((plan) => (
              <EngineTierCell key={plan.id} plan={plan} tier="ultra" comingSoonLabel={messages.plans.comingSoonCell} />
            ))}
          </tr>

          <tr className="border-b border-border">
            <td className="px-4 py-3 text-left text-ink-secondary">{rows.priority}</td>
            {PLANS.map((plan) => (
              <Cell key={plan.id}>{messages.plans.priorityLevels[plan.priority]}</Cell>
            ))}
          </tr>

          <tr className="border-b border-border">
            <td className="px-4 py-3 text-left text-ink-secondary">{rows.earlyAccess}</td>
            {PLANS.map((plan) => (
              <CheckCell key={plan.id} ok={hasFeature(plan, 'earlyAccess')} />
            ))}
          </tr>

          <tr className="border-b border-border">
            <td className="px-4 py-3 text-left text-ink-secondary">{rows.commercialUse}</td>
            {PLANS.map((plan) => (
              <CheckCell key={plan.id} ok={hasFeature(plan, 'commercialUse')} />
            ))}
          </tr>

          <tr>
            <td className="px-4 py-3 text-left text-ink-secondary">{rows.users}</td>
            {PLANS.map((plan) => (
              <Cell key={plan.id}>
                {plan.users}
                {!plan.multiUserImplemented && plan.users > 1 ? ` (${messages.plans.comingSoonSuffix})` : ''}
              </Cell>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
