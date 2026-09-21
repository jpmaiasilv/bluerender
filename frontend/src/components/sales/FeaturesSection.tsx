import { GraduationCap, Maximize2, PenSquare, RotateCw, Wand2 } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { FeatureStory } from './FeatureStory';
import { Reveal } from './Reveal';

/** Same tool ids/icons as config/tools.ts's `comingSoon` entries — kept as a local literal (not imported) since this only needs the icon + a preview image, not the full tool config shape. `image: null` (arquitetoEstagiario) falls back to an icon tile instead of a broken/missing photo. */
const COMING_SOON_TOOLS = [
  { id: 'melhorarRender', icon: Wand2, image: '/images/home/tool-improve-render.png' },
  { id: 'multiangulo', icon: RotateCw, image: '/images/home/tool-multiangle.png' },
  { id: 'upscale', icon: Maximize2, image: '/images/home/tool-upscale.png' },
  { id: 'editorIa', icon: PenSquare, image: '/images/home/tool-editor-ia.png' },
  { id: 'arquitetoEstagiario', icon: GraduationCap, image: null },
] as const;

/** Real, available tools get a full editorial story block each; not-yet-built tools get one compact, honestly-labeled strip — never a fabricated demo. */
export function FeaturesSection() {
  const { messages } = useLanguage();
  const t = messages.sales.features;

  return (
    <section id="recursos" className="bg-surface py-14 sm:py-20">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="mb-12 text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t.title}</h2>
          <p className="mt-3 text-base text-ink-secondary">{t.subtitle}</p>
        </Reveal>

        <div className="flex flex-col gap-16">
          <FeatureStory
            title={t.render.title}
            body={t.render.body}
            cta={t.render.cta}
            href="/render"
            mood="facade"
            eventId="render"
            beforeSrc="/images/head/13.png"
            afterSrc="/images/head/12.png"
          />
          <FeatureStory
            title={t.ideas.title}
            body={t.ideas.body}
            cta={t.ideas.cta}
            href="/gerador-de-ideias"
            mood="landscape"
            reverse
            eventId="ideas"
            imageSrc="/images/home/tool-idea-generator.png"
          />
          <FeatureStory
            title={t.textToImage.title}
            body={t.textToImage.body}
            cta={t.textToImage.cta}
            href="/imagem-por-texto"
            mood="commercial"
            eventId="text-to-image"
          />
          <FeatureStory title={t.reference.title} body={t.reference.body} cta={t.reference.cta} href="/gerador-de-ideias" mood="interior" reverse eventId="reference" />
          <FeatureStory title={t.video.title} body={t.video.body} cta={t.video.cta} href="/video-ia" mood="landscape" eventId="video" />
          <FeatureStory
            title={t.plantaHumanizada.title}
            body={t.plantaHumanizada.body}
            cta={t.plantaHumanizada.cta}
            href="/planta-humanizada"
            mood="commercial"
            reverse
            eventId="planta-humanizada"
            imageSrc="/images/home/tool-floor-plan.png"
          />
        </div>

        <Reveal delayMs={80} className="mt-16 rounded-3xl border border-dashed border-border bg-surface-secondary/60 p-6 sm:p-8">
          <div className="text-center">
            <h3 className="text-base font-semibold text-ink">{t.comingSoonTitle}</h3>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-ink-secondary">{t.comingSoonBody}</p>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {COMING_SOON_TOOLS.map((tool) => (
              <div key={tool.id} className="flex flex-col rounded-2xl border border-border bg-surface shadow-card">
                <div className="relative h-20 w-full shrink-0 overflow-hidden rounded-t-2xl bg-surface-secondary">
                  {tool.image ? (
                    <img src={tool.image} alt="" aria-hidden="true" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <tool.icon size={24} className="text-sapphire" strokeWidth={1.75} />
                    </div>
                  )}
                  <span className="absolute right-2 top-2 rounded-full bg-surface/90 px-1.5 py-0.5 text-[9px] font-semibold text-ink-muted backdrop-blur-sm">
                    {messages.nav.comingSoonBadge}
                  </span>
                </div>
                <div className="relative z-10 -mt-4 ml-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface shadow-card ring-1 ring-border">
                  <tool.icon size={15} className="text-sapphire" strokeWidth={2} />
                </div>
                <div className="px-3 pb-3 pt-1.5">
                  <h4 className="text-xs font-semibold leading-tight text-ink">{messages.nav.items[tool.id]}</h4>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
