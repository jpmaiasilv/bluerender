import { Check, X } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { Reveal } from './Reveal';

export function WorkflowComparison() {
  const { messages } = useLanguage();
  const t = messages.sales.comparison;

  return (
    <section className="bg-surface-secondary/60 py-14 sm:py-20">
      <div className="mx-auto max-w-4xl px-5 sm:px-8">
        <Reveal className="text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t.title}</h2>
        </Reveal>

        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Reveal>
            <div className="h-full rounded-2xl border border-border bg-surface p-7 opacity-70">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{t.traditionalTitle}</h3>
              <ul className="mt-5 flex flex-col gap-3.5">
                {t.traditionalSteps.map((step) => (
                  <li key={step} className="flex items-center gap-2.5 text-sm text-ink-secondary">
                    <X size={14} className="shrink-0 text-ink-muted" />
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delayMs={100}>
            <div className="h-full rounded-2xl border-2 border-sapphire bg-surface p-7 shadow-glow">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-sapphire">{t.blueRenderTitle}</h3>
              <ul className="mt-5 flex flex-col gap-3.5">
                {t.blueRenderSteps.map((step) => (
                  <li key={step} className="flex items-center gap-2.5 text-sm font-medium text-ink">
                    <Check size={14} className="shrink-0 text-sapphire" />
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
