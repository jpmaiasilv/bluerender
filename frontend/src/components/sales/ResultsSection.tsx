import { useLanguage } from '../../i18n';
import { SalesArt } from './SalesArt';
import { Reveal } from './Reveal';

/** Reuses three of the gallery's own real photos (see GallerySection.tsx) instead of asking for dedicated duplicates just for this mosaic. */
const MOSAIC = [
  { mood: 'facade', src: '/images/sales/gallery-01.jpg' },
  { mood: 'interior', src: '/images/sales/gallery-02.jpg' },
  { mood: 'commercial', src: '/images/sales/gallery-03.jpg' },
] as const;

/**
 * Deliberately replaces fabricated social proof (no fake testimonials,
 * client logos, star ratings or numbers — none exist for real yet). The
 * component structure is ready for real testimonials later: swap the
 * mosaic below for a <TestimonialCard> list once real quotes exist.
 */
export function ResultsSection() {
  const { messages } = useLanguage();
  const t = messages.sales.results;

  return (
    <section className="bg-surface py-14 sm:py-20">
      <div className="mx-auto max-w-4xl px-5 text-center sm:px-8">
        <Reveal>
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t.title}</h2>
          <p className="mx-auto mt-3 max-w-lg text-base text-ink-secondary">{t.body}</p>
        </Reveal>

        <Reveal delayMs={100} className="mt-9 grid grid-cols-3 gap-3 sm:gap-4">
          {MOSAIC.map((item) => (
            <div key={item.mood} className="aspect-square overflow-hidden rounded-2xl border border-border">
              <SalesArt mood={item.mood} variant="render" srcOverride={item.src} className="h-full w-full" />
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
