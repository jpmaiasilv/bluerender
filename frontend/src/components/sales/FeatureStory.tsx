import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ArtMood } from './PlaceholderArt';
import { BeforeAfterSlider } from './BeforeAfterSlider';
import { SalesArt } from './SalesArt';
import { Reveal } from './Reveal';
import { useSalesCta } from './useSalesCta';
import { trackEvent } from '../../lib/analytics/trackEvent';

interface Props {
  title: string;
  body: string;
  cta: string;
  href: string;
  mood: ArtMood;
  reverse?: boolean;
  eventId: string;
  /** A single real product visual (e.g. a moodboard/UI shot) instead of the sketch/render slider — used when the feature isn't a "before/after" transformation, so a fabricated sketch pairing would misrepresent it. Takes priority over `mood` when set. */
  imageSrc?: string;
  /** Overrides the mood-based sketch/render pair with specific real photos, while keeping the interactive slider (unlike `imageSrc`, which replaces the slider with one static image). Only applies to this one story — other consumers of `mood` (e.g. InteractiveDemo's tabs) are unaffected. */
  beforeSrc?: string;
  afterSrc?: string;
}

/** One large alternating image/text block per real tool — reused instead of a grid of small cards, per the "editorial, not a catalog" direction. */
export function FeatureStory({ title, body, cta, href, mood, reverse, eventId, imageSrc, beforeSrc, afterSrc }: Props) {
  const { toolHref } = useSalesCta();

  return (
    <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-12">
      <Reveal className={reverse ? 'order-2 lg:order-2' : 'order-2 lg:order-1'}>
        {imageSrc ? (
          <div className="aspect-[16/10] w-full overflow-hidden rounded-3xl border border-border bg-surface-secondary shadow-[0_24px_80px_-24px_rgba(17,24,39,0.25)]">
            <img src={imageSrc} alt={title} loading="lazy" className="h-full w-full object-cover" />
          </div>
        ) : (
          <BeforeAfterSlider
            before={<SalesArt mood={mood} variant="sketch" srcOverride={beforeSrc} className="h-full w-full" />}
            after={<SalesArt mood={mood} variant="render" srcOverride={afterSrc} className="h-full w-full" alt="Blue Render" />}
            beforeLabel="—"
            afterLabel="Blue Render"
          />
        )}
      </Reveal>
      <Reveal delayMs={80} className={reverse ? 'order-1 lg:order-1' : 'order-1 lg:order-2'}>
        <h3 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{title}</h3>
        <p className="mt-4 max-w-md text-base leading-relaxed text-ink-secondary">{body}</p>
        <Link
          to={toolHref(href)}
          onClick={() => trackEvent('feature_view', { feature: eventId })}
          className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-sapphire transition hover:gap-2.5"
        >
          {cta}
          <ArrowUpRight size={15} />
        </Link>
      </Reveal>
    </div>
  );
}
