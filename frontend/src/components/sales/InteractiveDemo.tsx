import { useState } from 'react';
import { useLanguage } from '../../i18n';
import { BeforeAfterSlider } from './BeforeAfterSlider';
import { ArtMood } from './PlaceholderArt';
import { SalesArt } from './SalesArt';
import { Reveal } from './Reveal';
import { trackEvent } from '../../lib/analytics/trackEvent';

type CategoryKey = 'interior' | 'exterior' | 'commercial' | 'landscape';

const CATEGORY_MOOD: Record<CategoryKey, ArtMood> = {
  interior: 'interior',
  exterior: 'facade',
  commercial: 'commercial',
  landscape: 'landscape',
};

// Real photo pair for the Exterior tab only — other tabs keep using the
// mood-based /images/sales/{mood}-before/after.jpg pair via SalesArt.
const CATEGORY_SRC_OVERRIDE: Partial<Record<CategoryKey, { before: string; after: string }>> = {
  exterior: { before: '/images/head/14.png', after: '/images/head/15.jpg' },
};

const CATEGORIES: CategoryKey[] = ['interior', 'exterior', 'commercial', 'landscape'];

export function InteractiveDemo() {
  const { messages } = useLanguage();
  const t = messages.sales.demo;
  const [active, setActive] = useState<CategoryKey>('interior');

  return (
    <section id="resultados" className="bg-surface py-14 sm:py-20">
      <div className="mx-auto max-w-5xl px-5 sm:px-8">
        <Reveal className="text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t.title}</h2>
          <p className="mt-3 text-base text-ink-secondary">{t.subtitle}</p>
        </Reveal>

        <Reveal delayMs={100} className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {CATEGORIES.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setActive(key);
                trackEvent('demo_category_selected', { category: key });
              }}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                active === key ? 'bg-sapphire text-white shadow-glow' : 'border border-border text-ink-secondary hover:border-sapphire/40 hover:text-ink'
              }`}
            >
              {t.categories[key]}
            </button>
          ))}
        </Reveal>

        <Reveal delayMs={180} className="mt-8">
          <BeforeAfterSlider
            key={active}
            before={
              <SalesArt
                mood={CATEGORY_MOOD[active]}
                variant="sketch"
                srcOverride={CATEGORY_SRC_OVERRIDE[active]?.before}
                className="h-full w-full"
                alt={t.beforeLabel}
              />
            }
            after={
              <SalesArt
                mood={CATEGORY_MOOD[active]}
                variant="render"
                srcOverride={CATEGORY_SRC_OVERRIDE[active]?.after}
                className="h-full w-full"
                alt={t.afterLabel}
              />
            }
            beforeLabel={t.beforeLabel}
            afterLabel={t.afterLabel}
            onInteract={() => trackEvent('before_after_interaction', { location: 'demo' }, { once: true })}
          />
        </Reveal>
      </div>
    </section>
  );
}
