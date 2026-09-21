import { Gauge, Sparkles, Zap } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { Reveal } from './Reveal';

/** Uses the real commercial engine-tier names (Fast/Pro/Ultra — config/plans.ts's CommercialEngineTier), never the underlying provider/model names, which stay internal-only (see backend/src/config/engines.ts). Ultra is never shown as available — it isn't implemented anywhere yet. */
export function ModelSelectorShowcase() {
  const { messages } = useLanguage();
  const t = messages.sales.models;

  const tiers = [
    { icon: Zap, title: t.fastTitle, body: t.fastBody, available: true },
    { icon: Gauge, title: t.proTitle, body: t.proBody, available: true },
    { icon: Sparkles, title: t.ultraTitle, body: t.ultraBody, available: false },
  ];

  return (
    <section className="bg-surface-secondary/60 py-14 sm:py-20">
      <div className="mx-auto max-w-5xl px-5 text-center sm:px-8">
        <Reveal>
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t.title}</h2>
          <p className="mx-auto mt-3 max-w-xl text-base text-ink-secondary">{t.subtitle}</p>
        </Reveal>

        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {tiers.map((tier, index) => (
            <Reveal key={tier.title} delayMs={index * 100}>
              <div className="relative flex h-full flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-8 text-center shadow-card">
                {!tier.available && (
                  <span className="absolute right-4 top-4 rounded-full bg-surface-secondary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                    {t.comingSoonBadge}
                  </span>
                )}
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sapphire-light text-sapphire">
                  <tier.icon size={22} />
                </div>
                <h3 className="text-lg font-semibold text-ink">{tier.title}</h3>
                <p className="text-sm text-ink-secondary">{tier.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
