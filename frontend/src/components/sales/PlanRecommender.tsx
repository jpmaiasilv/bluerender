import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { PLANS, PlanId } from '../../config/plans';
import { useLanguage } from '../../i18n';
import { Reveal } from './Reveal';
import { useSalesCta } from './useSalesCta';
import { trackEvent } from '../../lib/analytics/trackEvent';

const PLAN_ORDER: PlanId[] = ['starter', 'pro', 'studio'];

function recommend(volumeIndex: number, isTeam: boolean): PlanId {
  let idx = volumeIndex;
  if (isTeam && idx < 2) idx += 1;
  return PLAN_ORDER[idx];
}

/** Local, client-only recommendation — never blocks or hides the other plans, purely a nudge. No backend needed. */
export function PlanRecommender() {
  const { messages } = useLanguage();
  const t = messages.sales.recommender;
  const { pricingHref } = useSalesCta();
  const [volumeIndex, setVolumeIndex] = useState<number | null>(null);
  const [isTeam, setIsTeam] = useState<boolean | null>(null);

  const step = volumeIndex === null ? 1 : isTeam === null ? 2 : 3;
  const recommendedId = volumeIndex !== null && isTeam !== null ? recommend(volumeIndex, isTeam) : null;
  const recommendedPlan = recommendedId ? PLANS.find((p) => p.id === recommendedId) : null;

  function reset() {
    setVolumeIndex(null);
    setIsTeam(null);
  }

  return (
    <section className="bg-surface-secondary/60 py-12">
      <div className="mx-auto max-w-lg px-5 sm:px-8">
        <Reveal>
          <div className="rounded-2xl border border-border bg-surface p-7 shadow-card">
            <h2 className="text-center text-lg font-semibold text-ink">{t.title}</h2>
            <p className="mt-1 text-center text-sm text-ink-secondary">{t.subtitle}</p>

            {step === 1 && (
              <div className="mt-6">
                <p className="mb-3 text-sm font-medium text-ink">{t.q1}</p>
                <div className="flex flex-col gap-2">
                  {t.q1Options.map((label, index) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setVolumeIndex(index)}
                      className="rounded-lg border border-border px-4 py-2.5 text-left text-sm font-medium text-ink transition hover:border-sapphire hover:bg-sapphire-soft"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="mt-6">
                <p className="mb-3 text-sm font-medium text-ink">{t.q2}</p>
                <div className="flex flex-col gap-2">
                  {t.q2Options.map((label, index) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        const team = index === 1;
                        setIsTeam(team);
                        trackEvent('plan_recommendation_completed', { plan: recommend(volumeIndex ?? 0, team) });
                      }}
                      className="rounded-lg border border-border px-4 py-2.5 text-left text-sm font-medium text-ink transition hover:border-sapphire hover:bg-sapphire-soft"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 3 && recommendedPlan && (
              <div className="mt-6 text-center">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t.resultPrefix}</p>
                <p className="mt-2 text-2xl font-semibold text-sapphire">{messages.plans.names[recommendedPlan.id]}</p>
                <p className="mt-1 text-sm text-ink-secondary">{messages.plans.descriptions[recommendedPlan.id]}</p>
                <div className="mt-5 flex items-center justify-center gap-3">
                  <Link
                    to={pricingHref}
                    onClick={() => trackEvent('plan_selected', { plan: recommendedPlan.id, source: 'recommender' })}
                    className="rounded-lg bg-sapphire px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:bg-sapphire-hover"
                  >
                    {messages.plans.cta[recommendedPlan.id]}
                  </Link>
                  <button
                    type="button"
                    onClick={reset}
                    className="flex items-center gap-1.5 text-sm font-medium text-ink-secondary transition hover:text-ink"
                  >
                    <RotateCcw size={14} />
                    {t.restart}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
