import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { Reveal } from './Reveal';
import { trackEvent } from '../../lib/analytics/trackEvent';

export function FaqSection() {
  const { messages } = useLanguage();
  const t = messages.sales.faq;
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="bg-surface-secondary/60 py-14 sm:py-20">
      <div className="mx-auto max-w-2xl px-5 sm:px-8">
        <Reveal className="text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t.title}</h2>
          <p className="mt-3 text-base text-ink-secondary">{t.subtitle}</p>
        </Reveal>

        <Reveal delayMs={80} className="mt-8 flex flex-col divide-y divide-border rounded-2xl border border-border bg-surface">
          {t.items.map((item, index) => {
            const isOpen = openIndex === index;
            return (
              <div key={item.q}>
                <button
                  type="button"
                  onClick={() => {
                    const next = isOpen ? null : index;
                    setOpenIndex(next);
                    if (next !== null) trackEvent('faq_open', { question: item.q });
                  }}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                >
                  <span className="text-sm font-medium text-ink">{item.q}</span>
                  <ChevronDown size={16} className={`shrink-0 text-ink-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && <p className="px-5 pb-4 text-sm leading-relaxed text-ink-secondary">{item.a}</p>}
              </div>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}
