import { PlayCircle, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../i18n';

function scrollToCreateSection() {
  document.getElementById('criar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * The Home page's own hero — deliberately not HeroCompareSlider/BeforeAfterSlider
 * from the sales page (different context, and the spec explicitly asks for a
 * light static visual here, not a heavier interactive component).
 *
 * The banner image (frontend/public/images/home/hero-banner.png) is a full
 * wide shot — house + the "Original | Render IA" comparison built in on the
 * right, fading to a light, empty area on the left. It's meant to run as one
 * free-flowing horizontal banner, not be boxed into a cropped side column —
 * so it's the section's own background (object-cover, no separate rounded
 * card around it), with the greeting/CTA content overlaid on that light left
 * side. A left-to-right scrim guarantees the text stays readable regardless
 * of exactly how the crop lands at a given width.
 */
export function HomeHero() {
  const { messages } = useLanguage();
  const t = messages.home;

  return (
    <section className="relative overflow-hidden rounded-3xl border border-border shadow-sm">
      <img
        src="/images/home/hero-banner.png"
        alt={`${t.hero.compareOriginal} / ${t.hero.compareRender}`}
        loading="eager"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-surface via-surface/85 to-transparent sm:via-surface/70" />

      <div className="relative flex min-h-[420px] flex-col justify-center p-6 sm:p-8 lg:min-h-[460px] lg:p-10">
        <div className="max-w-[520px]">
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t.greeting}</h1>
          <p className="mt-1 text-lg text-ink-secondary sm:text-xl">{t.subtitle}</p>

          <div className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
            <h2 className="text-lg font-semibold text-ink">{t.hero.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{t.hero.description}</p>
            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
              <Link
                to="/render"
                className="flex items-center justify-center gap-2 rounded-xl bg-sapphire px-5 py-3 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:bg-sapphire-hover"
              >
                <Sparkles size={16} />
                {t.hero.ctaPrimary}
              </Link>
              <button
                type="button"
                onClick={scrollToCreateSection}
                className="flex items-center justify-center gap-2 rounded-xl border border-border px-5 py-3 text-sm font-semibold text-ink transition hover:bg-surface-secondary"
              >
                <PlayCircle size={16} className="text-sapphire" />
                {t.hero.ctaSecondary}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
