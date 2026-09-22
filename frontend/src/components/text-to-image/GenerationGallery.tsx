import { Download, ImagePlus, Maximize2, RefreshCcw, Video } from 'lucide-react';
import { T2IGeneratedImage } from '../../types';
import { useLanguage } from '../../i18n';

interface CardProps {
  image: T2IGeneratedImage;
  index: number;
  onUseAsReference: (image: T2IGeneratedImage) => void;
  /** The single-image layout: sized from the image's own aspect ratio instead of forced into a fixed-shape tile, so a portrait or ultra-wide render is never cropped to fit a square/4:3 box. */
  hero?: boolean;
}

function GenerationCard({ image, index, onUseAsReference, hero }: CardProps) {
  const { messages } = useLanguage();
  const t = messages.textToImage.results;

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
            onClick={() => onUseAsReference(image)}
            className="flex items-center gap-1.5 rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-medium text-ink transition hover:bg-white"
          >
            <ImagePlus size={13} />
            {t.useAsReference}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="flex items-center gap-1.5 rounded-lg bg-white/60 px-2.5 py-1.5 text-xs font-medium text-ink-muted">
            <RefreshCcw size={13} />
            {t.variation} · {t.comingSoon}
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
  images: T2IGeneratedImage[];
  requestedCount: number;
  onUseAsReference: (image: T2IGeneratedImage) => void;
  onReusePrompt: () => void;
}

/** 1 image = full-width hero, 2 = side-by-side, 4 = 2x2 — images stay the visual protagonist. */
export function GenerationGallery({ images, requestedCount, onUseAsReference, onReusePrompt }: Props) {
  const { messages } = useLanguage();
  const t = messages.textToImage;

  const gridClass =
    images.length >= 4 ? 'grid grid-cols-2 gap-3' : images.length === 2 ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-1 gap-3';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {images.length < requestedCount ? (
          <p className="text-xs text-warning">{t.results.partialNotice(images.length, requestedCount)}</p>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onReusePrompt}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:border-sapphire/40 hover:text-ink"
        >
          {t.toolbar.reusePrompt}
        </button>
      </div>

      <div className={images.length === 1 ? '' : gridClass}>
        {images.map((image, index) => (
          <div key={image.requestId} className={images.length === 1 ? '' : `h-full ${images.length === 2 ? 'aspect-[4/3]' : 'aspect-square'}`}>
            <GenerationCard image={image} index={index} onUseAsReference={onUseAsReference} hero={images.length === 1} />
          </div>
        ))}
      </div>
    </div>
  );
}
