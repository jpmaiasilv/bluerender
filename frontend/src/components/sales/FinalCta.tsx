import { Link } from 'react-router-dom';
import { useLanguage } from '../../i18n';
import { SalesArt } from './SalesArt';
import { Reveal } from './Reveal';
import { useSalesCta } from './useSalesCta';
import { trackEvent } from '../../lib/analytics/trackEvent';

export function FinalCta() {
  const { messages } = useLanguage();
  const t = messages.sales.finalCta;
  const { primaryHref } = useSalesCta();

  return (
    <section className="relative overflow-hidden bg-ink py-16 sm:py-24">
      <div className="absolute inset-0 opacity-25">
        <SalesArt mood="facade" variant="render" className="h-full w-full" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/85 to-ink/60" />

      <div className="relative mx-auto max-w-2xl px-5 text-center sm:px-8">
        <Reveal>
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-white sm:text-5xl">{t.headline}</h2>
          <p className="mx-auto mt-4 max-w-lg text-base text-white/70">{t.subheadline}</p>
        </Reveal>
        <Reveal delayMs={100}>
          <Link
            to={primaryHref}
            onClick={() => trackEvent('final_cta_click')}
            className="mt-8 inline-block rounded-xl bg-sapphire px-8 py-4 text-base font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:bg-sapphire-hover"
          >
            {t.cta}
          </Link>
          <p className="mt-4 text-xs font-medium text-white/50">{t.trustLine}</p>
        </Reveal>
      </div>
    </section>
  );
}
