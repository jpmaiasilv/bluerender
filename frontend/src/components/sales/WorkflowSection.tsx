import { useLanguage } from '../../i18n';
import { Reveal } from './Reveal';

export function WorkflowSection() {
  const { messages } = useLanguage();
  const t = messages.sales.workflow;

  return (
    <section id="como-funciona" className="bg-surface-secondary/60 py-14 sm:py-20">
      <div className="mx-auto max-w-5xl px-5 sm:px-8">
        <Reveal className="text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t.title}</h2>
          <p className="mx-auto mt-3 max-w-xl text-base text-ink-secondary">{t.subtitle}</p>
        </Reveal>

        <div className="relative mt-12 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          <div className="pointer-events-none absolute left-0 right-0 top-6 hidden h-px bg-border lg:block" aria-hidden="true" />
          {t.steps.map((step, index) => (
            <Reveal key={step.title} delayMs={index * 90} className="relative flex flex-col items-start gap-3 lg:items-center lg:text-center">
              <span className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sapphire text-sm font-semibold text-white shadow-glow">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="text-base font-semibold text-ink">{step.title}</h3>
              <p className="text-sm leading-relaxed text-ink-secondary lg:max-w-[200px]">{step.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
