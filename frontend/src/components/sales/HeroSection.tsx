import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlayCircle } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { HeroCompareSlider } from './HeroCompareSlider';
import { SalesArt } from './SalesArt';
import { Reveal } from './Reveal';
import { useSalesCta } from './useSalesCta';
import { trackEvent } from '../../lib/analytics/trackEvent';

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function HeroSection() {
  const { messages } = useLanguage();
  const t = messages.sales.hero;
  const { primaryHref } = useSalesCta();

  // Sized to the real image the moment it loads (see HeroCompareSlider's
  // aspectRatio prop) instead of forcing a fixed box — whichever of the two
  // layers loads first wins, via the ref guard, so the container doesn't
  // jump again if the second layer reports a different ratio. Clamped to
  // never go narrower than 16:10 (the component's own original default,
  // still used as the fallback below before any image has loaded) — a
  // square or portrait source photo would otherwise stretch the box up to
  // its own width, producing a hero far taller than a banner should be.
  const [naturalRatio, setNaturalRatio] = useState<number | null>(null);
  const ratioLockedRef = useRef(false);
  function handleNaturalSize(width: number, height: number) {
    if (ratioLockedRef.current) return;
    ratioLockedRef.current = true;
    setNaturalRatio(Math.max(width / height, 16 / 10));
  }

  return (
    <section className="relative overflow-hidden bg-surface pb-14 pt-8 sm:pb-20 sm:pt-12">
      <div className="mx-auto max-w-5xl px-5 text-center sm:px-8">
        <Reveal>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-secondary px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-sapphire">
            {t.eyebrow}
          </span>
        </Reveal>
        <Reveal delayMs={80}>
          <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-ink sm:text-6xl lg:text-[64px]">
            {t.headline}
          </h1>
        </Reveal>
        <Reveal delayMs={160}>
          <p className="mx-auto mt-5 max-w-2xl text-balance text-base leading-relaxed text-ink-secondary sm:text-lg">{t.subheadline}</p>
        </Reveal>
        <Reveal delayMs={240}>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to={primaryHref}
              onClick={() => trackEvent('hero_cta_click', { location: 'hero_primary' })}
              className="w-full rounded-xl bg-sapphire px-7 py-3.5 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:bg-sapphire-hover sm:w-auto"
            >
              {t.ctaPrimary}
            </Link>
            <button
              type="button"
              onClick={() => scrollToSection('como-funciona')}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border px-7 py-3.5 text-sm font-semibold text-ink transition hover:bg-surface-secondary sm:w-auto"
            >
              <PlayCircle size={17} className="text-sapphire" />
              {t.ctaSecondary}
            </button>
          </div>
          <p className="mt-3 text-xs font-medium text-ink-muted">{t.trustLine}</p>
        </Reveal>
      </div>

      <Reveal delayMs={320} className="mt-12 sm:mt-16">
        <HeroCompareSlider
          original={
            <SalesArt
              mood="facade"
              variant="sketch"
              srcOverride="/images/head/2.jpg"
              fit="cover"
              className="h-full w-full object-center"
              alt={t.beforeLabel}
              onNaturalSize={handleNaturalSize}
            />
          }
          render={
            <SalesArt
              mood="facade"
              variant="render"
              srcOverride="/images/head/1.jpg"
              fit="cover"
              className="h-full w-full object-center"
              alt={t.afterLabel}
              onNaturalSize={handleNaturalSize}
            />
          }
          originalLabel={t.beforeLabel}
          renderLabel={t.afterLabel}
          aspectRatio={naturalRatio}
          onInteract={() => trackEvent('before_after_interaction', { location: 'hero' }, { once: true })}
        />
      </Reveal>
    </section>
  );
}
