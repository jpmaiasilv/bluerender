import { ArrowRight, Cpu, Globe, Sparkles } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { Logo } from '../Logo';
import { Reveal } from './Reveal';

export function CloudSection() {
  const { messages } = useLanguage();
  const t = messages.sales.cloud;

  return (
    <section className="bg-surface py-14 sm:py-20">
      <div className="mx-auto max-w-4xl px-5 text-center sm:px-8">
        <Reveal>
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t.title}</h2>
          <p className="mx-auto mt-3 max-w-xl text-base text-ink-secondary">{t.subtitle}</p>
        </Reveal>

        <Reveal delayMs={120} className="mt-10 flex flex-col items-center justify-center gap-6 sm:flex-row sm:gap-10">
          <div className="flex flex-col items-center gap-2 opacity-60">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-dashed border-border text-ink-muted">
              <Cpu size={26} />
            </div>
            <span className="text-xs font-medium text-ink-muted">{t.traditionalLabel}</span>
          </div>

          <ArrowRight size={20} className="hidden text-ink-muted sm:block" />

          <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface-secondary px-6 py-4 shadow-card">
            <Globe size={20} className="text-sapphire" />
            <ArrowRight size={14} className="text-ink-muted" />
            <Logo markOnly size={20} />
            <ArrowRight size={14} className="text-ink-muted" />
            <Sparkles size={18} className="text-sapphire" />
          </div>
        </Reveal>
        <Reveal delayMs={180}>
          <p className="mt-4 text-xs font-medium text-ink-muted">{t.blueRenderLabel}</p>
        </Reveal>
      </div>
    </section>
  );
}
