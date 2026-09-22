import { useState } from 'react';
import { Download, ImagePlus, Maximize2, RefreshCcw, Video, Wand2 } from 'lucide-react';
import { IdeaGeneratedImage } from '../../types';
import { CompareSlider } from '../CompareSlider';
import { useLanguage } from '../../i18n';

interface CardProps {
  image: IdeaGeneratedImage;
  index: number;
  onGenerateVariation: (image: IdeaGeneratedImage) => void;
  onUseAsNewBase: (image: IdeaGeneratedImage) => void;
  /** The single-image layout: sized from the image's own aspect ratio instead of forced into a fixed-shape tile, so a portrait or ultra-wide render is never cropped to fit a square/4:3 box. */
  hero?: boolean;
}

function IdeaResultCard({ image, index, onGenerateVariation, onUseAsNewBase, hero }: CardProps) {
  const { messages } = useLanguage();
  const t = messages.ideaGenerator.results;

  return (
    <div className={`group relative overflow-hidden rounded-2xl border border-border bg-surface-secondary shadow-card ${hero ? '' : 'h-full'}`}>
      <img
        src={image.imageUrl}
        alt={`${index + 1}`}
        className={hero ? 'block max-h-[70vh] w-auto max-w-full mx-auto object-contain' : 'h-full w-full object-contain'}
      />
      <div className="absolute inset-0 flex flex-col justify-end gap-1.5 bg-gradient-to-t from-ink/70 via-transparent to-transparent p-3 opacity-0 transition group-hover:opacity-100">
        <div className="flex flex-wrap gap-1.5">
          <a
            href={image.imageUrl}
            download
            className="flex items-center gap-1.5 rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-medium text-ink transition hover:bg-white"
          >
            <Download size={13} />
            {t.download}
          </a>
          <button
            type="button"
            onClick={() => onUseAsNewBase(image)}
            className="flex items-center gap-1.5 rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-medium text-ink transition hover:bg-white"
          >
            <ImagePlus size={13} />
            {t.useAsNewBase}
          </button>
          <button
            type="button"
            onClick={() => onGenerateVariation(image)}
            className="flex items-center gap-1.5 rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-medium text-ink transition hover:bg-white"
          >
            <RefreshCcw size={13} />
            {t.variation}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="flex items-center gap-1.5 rounded-lg bg-white/60 px-2.5 py-1.5 text-xs font-medium text-ink-muted">
            <Wand2 size={13} />
            {t.improveRender} · {t.comingSoon}
          </span>
          <span className="flex items-center gap-1.5 rounded-lg bg-white/60 px-2.5 py-1.5 text-xs font-medium text-ink-muted">
            <Maximize2 size={13} />
            {t.upscale} · {t.comingSoon}
          </span>
          <span className="flex items-center gap-1.5 rounded-lg bg-white/60 px-2.5 py-1.5 text-xs font-medium text-ink-muted">
            <Video size={13} />
            {t.video} · {t.comingSoon}
          </span>
        </div>
      </div>
    </div>
  );
}

interface Props {
  images: IdeaGeneratedImage[];
  requestedCount: number;
  originalImageUrl: string | null;
  onReuseSettings: () => void;
  onGenerateVariation: (image: IdeaGeneratedImage) => void;
  onUseAsNewBase: (image: IdeaGeneratedImage) => void;
}

/** 1 idea = full-width hero, 2 = side-by-side, 4 = 2x2 — mirrors Imagem por Texto's gallery layout rules. */
export function IdeaResultGallery({ images, requestedCount, originalImageUrl, onReuseSettings, onGenerateVariation, onUseAsNewBase }: Props) {
  const { messages } = useLanguage();
  const t = messages.ideaGenerator;
  const [comparing, setComparing] = useState(false);

  const gridClass = images.length >= 2 ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-1 gap-3';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {images.length < requestedCount ? (
          <p className="text-xs text-warning">{t.results.partialNotice(images.length, requestedCount)}</p>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {originalImageUrl && (
            <button
              type="button"
              onClick={() => setComparing((v) => !v)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                comparing ? 'border-sapphire bg-sapphire-light text-sapphire' : 'border-border bg-surface text-ink-secondary hover:border-sapphire/40'
              }`}
            >
              {t.results.compareWithOriginal}
            </button>
          )}
          <button
            type="button"
            onClick={onReuseSettings}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
          >
            {t.results.reuseSettings}
          </button>
        </div>
      </div>

      {comparing && originalImageUrl ? (
        <CompareSlider
          beforeSrc={originalImageUrl}
          afterSrc={images[0].imageUrl}
          beforeLabel={t.results.before}
          afterLabel={t.results.after}
        />
      ) : (
        <div className={images.length === 1 ? '' : gridClass}>
          {images.map((image, index) => (
            <div key={image.requestId} className={images.length === 1 ? '' : `h-full ${images.length === 2 ? 'aspect-[4/3]' : 'aspect-square'}`}>
              <IdeaResultCard
                image={image}
                index={index}
                onGenerateVariation={onGenerateVariation}
                onUseAsNewBase={onUseAsNewBase}
                hero={images.length === 1}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
