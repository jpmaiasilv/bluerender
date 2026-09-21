import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import {
  annualMonthlyEquivalent,
  annualSavings,
  BillingCycle,
  fastRenderCapacity,
  PLANS,
} from '../../config/plans';
import { useLanguage } from '../../i18n';
import { BillingCycleToggle } from '../BillingCycleToggle';
import { Modal } from '../Modal';
import { Reveal } from './Reveal';
import { useSalesCta } from './useSalesCta';
import { trackEvent } from '../../lib/analytics/trackEvent';

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Real credit costs per tool — see backend/src/config/engines.ts (Render IA / Imagem por Texto / Gerador de Ideias all share the same Fast=2 / Pro=5 / Ultra=10 table) and backend/src/config/videoEngines.ts's CREDIT_TABLE (Vídeo IA, priced per duration, not per image). Never invented. */
const SHARED_COST_TOOL_IDS = ['render', 'imagemPorTexto', 'ideaGenerator'] as const;
const VIDEO_USAGE = [
  { duration: '3s', credits: 20 },
  { duration: '5s', credits: 35 },
  { duration: '8s', credits: 55 },
];

export function PricingSection() {
  const { messages } = useLanguage();
  const t = messages.sales.pricing;
  const { pricingHref } = useSalesCta();
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [usageOpen, setUsageOpen] = useState(false);

  return (
    <section id="precos" className="bg-surface py-14 sm:py-20">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t.title}</h2>
          <p className="mx-auto mt-3 max-w-xl text-base text-ink-secondary">{t.subtitle}</p>
        </Reveal>

        <Reveal delayMs={80} className="mt-6 flex justify-center">
          <BillingCycleToggle
            value={cycle}
            onChange={(v) => {
              setCycle(v);
              trackEvent('billing_toggle', { cycle: v });
            }}
          />
        </Reveal>

        <div className="mt-9 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {PLANS.map((plan, index) => {
            const price = cycle === 'monthly' ? plan.pricing.BRL.monthlyPrice : annualMonthlyEquivalent(plan);
            return (
              <Reveal key={plan.id} delayMs={index * 90}>
                <div
                  className={`relative flex h-full flex-col rounded-2xl border p-7 ${
                    plan.recommended ? 'border-sapphire bg-surface shadow-glow lg:-translate-y-2' : 'border-border bg-surface shadow-card'
                  }`}
                >
                  {plan.recommended && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-sapphire px-3 py-1 text-[11px] font-semibold text-white">
                      {messages.plans.mostPopular}
                    </span>
                  )}
                  <h3 className="text-lg font-semibold text-ink">{messages.plans.names[plan.id]}</h3>
                  <p className="mt-1 text-sm text-ink-secondary">{messages.plans.descriptions[plan.id]}</p>

                  <div className="mt-5 flex items-baseline gap-1">
                    <span className="text-3xl font-semibold tracking-tight text-ink">{formatBRL(price)}</span>
                    <span className="text-sm text-ink-muted">{messages.plans.perMonth}</span>
                  </div>
                  {cycle === 'annual' && (
                    <p className="mt-1 text-xs font-medium text-success">{messages.plans.savings(formatBRL(annualSavings(plan)))}</p>
                  )}

                  <div className="mt-4 rounded-lg bg-surface-secondary px-3.5 py-2.5">
                    <p className="text-sm font-medium text-ink">{messages.plans.creditsPerMonth(plan.monthlyCredits)}</p>
                    <p className="mt-0.5 text-xs text-ink-secondary">{messages.plans.capacityLine(fastRenderCapacity(plan))}</p>
                  </div>

                  <ul className="mt-5 flex flex-1 flex-col gap-2.5">
                    {plan.features.slice(0, 6).map((f) => (
                      <li key={f.key} className="flex items-start gap-2 text-sm text-ink-secondary">
                        <Check size={14} className="mt-0.5 shrink-0 text-sapphire" />
                        {messages.plans.features[f.key]}
                        {f.future && <span className="text-ink-muted"> · {messages.plans.comingSoonSuffix}</span>}
                      </li>
                    ))}
                  </ul>

                  <Link
                    to={pricingHref}
                    onClick={() => trackEvent('plan_selected', { plan: plan.id, source: 'pricing' })}
                    className={`mt-6 rounded-xl py-3 text-center text-sm font-semibold transition ${
                      plan.recommended
                        ? 'bg-sapphire text-white hover:bg-sapphire-hover'
                        : 'border border-border text-ink hover:bg-surface-secondary'
                    }`}
                  >
                    {messages.plans.cta[plan.id]}
                  </Link>
                </div>
              </Reveal>
            );
          })}
        </div>

        <Reveal delayMs={200} className="mt-8 text-center">
          <button type="button" onClick={() => setUsageOpen(true)} className="text-sm font-medium text-sapphire hover:underline">
            {t.usageNote}
          </button>
        </Reveal>
      </div>

      <Modal open={usageOpen} onClose={() => setUsageOpen(false)} labelledBy="usage-modal-title" panelClassName="w-full max-w-lg">
        <div className="p-6">
          <h3 id="usage-modal-title" className="text-base font-semibold text-ink">
            {t.usageModalTitle}
          </h3>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="py-2 font-medium">{t.usageTableToolLabel}</th>
                <th className="py-2 text-right font-medium">{messages.plans.compareRows.fast}</th>
                <th className="py-2 text-right font-medium">{messages.plans.compareRows.pro}</th>
                <th className="py-2 text-right font-medium">{messages.plans.compareRows.ultra}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <td className="py-2.5 pr-3 text-ink-secondary">
                  {SHARED_COST_TOOL_IDS.map((id) => messages.nav.items[id]).join(' / ')}
                </td>
                <td className="py-2.5 text-right text-ink">2</td>
                <td className="py-2.5 text-right text-ink">5</td>
                <td className="py-2.5 text-right text-ink">10</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-ink-muted">{t.usageTableVideoLabel}</p>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {VIDEO_USAGE.map((row) => (
                <tr key={row.duration} className="border-b border-border last:border-none">
                  <td className="py-2 text-ink-secondary">{row.duration}</td>
                  <td className="py-2 text-right text-ink">{messages.wallet.creditsSuffix(row.credits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            onClick={() => setUsageOpen(false)}
            className="mt-5 w-full rounded-lg border border-border py-2.5 text-sm font-medium text-ink-secondary hover:bg-surface-secondary"
          >
            {t.usageModalClose}
          </button>
        </div>
      </Modal>
    </section>
  );
}
