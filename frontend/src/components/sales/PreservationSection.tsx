import { useLanguage } from '../../i18n';
import { BeforeAfterSlider } from './BeforeAfterSlider';
import { SalesArt } from './SalesArt';
import { Reveal } from './Reveal';

export function PreservationSection() {
  const { messages } = useLanguage();
  const t = messages.sales.preservation;
  const points = [t.points.geometry, t.points.perspective, t.points.volumetry, t.points.composition];

  return (
    <section className="bg-surface py-14 sm:py-20">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-5 sm:px-8 lg:grid-cols-2 lg:gap-12">
        <Reveal className="order-2 lg:order-1">
          <BeforeAfterSlider
            aspect="tall"
            before={<SalesArt mood="interior" variant="sketch" className="h-full w-full" alt={t.beforeLabel} />}
            after={<SalesArt mood="interior" variant="render" className="h-full w-full" alt={t.afterLabel} />}
            beforeLabel={t.beforeLabel}
            afterLabel={t.afterLabel}
          />
        </Reveal>

        <Reveal className="order-1 lg:order-2">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t.title}</h2>
          <p className="mt-4 text-base leading-relaxed text-ink-secondary">{t.body}</p>
          <ul className="mt-6 grid grid-cols-2 gap-3">
            {points.map((point) => (
              <li key={point} className="rounded-lg border border-border bg-surface-secondary px-3.5 py-2.5 text-sm font-medium text-ink">
                {point}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs text-ink-muted">{t.disclaimer}</p>
        </Reveal>
      </div>
    </section>
  );
}
