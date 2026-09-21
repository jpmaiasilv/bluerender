import { useEffect, useState } from 'react';
import { ArtMood, ArtVariant, PlaceholderArt } from './PlaceholderArt';

/**
 * Drop-in replacement for <PlaceholderArt> that tries a real image first and
 * only falls back to the abstract illustration if that image doesn't exist
 * (404) or fails to load. Public assets (frontend/public/images/sales/) are
 * never bundled/resolved by Vite, so a missing file never breaks the build —
 * it just falls back gracefully at runtime. Drop the real files in with the
 * expected names (see the folder's own naming convention) and this starts
 * using them automatically, no code change needed.
 */

const VARIANT_SUFFIX: Record<ArtVariant, 'before' | 'after'> = { sketch: 'before', render: 'after' };

interface Props {
  mood: ArtMood;
  variant: ArtVariant;
  className?: string;
  /** Use instead of the mood-based path for one-off images (e.g. gallery tiles) that don't follow the {mood}-{before|after}.jpg convention. */
  srcOverride?: string;
  alt?: string;
  /** 'cover' (default) crops to fill — matches every existing usage. 'contain' (hero only) shows the whole image with no cropping, letterboxed on the container's background if the ratios don't match. */
  fit?: 'cover' | 'contain';
  /** Fires once the real image has loaded, with its natural pixel size — lets a caller (e.g. HeroCompareSlider) size its container to the image's real aspect ratio instead of a fixed one. Never fires for the illustrated fallback, which has no "natural" size. */
  onNaturalSize?: (width: number, height: number) => void;
}

export function SalesArt({ mood, variant, className = '', srcOverride, alt = '', fit = 'cover', onNaturalSize }: Props) {
  const src = srcOverride ?? `/images/sales/${mood}-${VARIANT_SUFFIX[variant]}.jpg`;
  const [failed, setFailed] = useState(false);
  const fitClass = fit === 'contain' ? 'object-contain' : 'object-cover';

  // Reset the fallback state when the target image changes (e.g. switching
  // demo tabs) — otherwise a previous tab's missing image would "stick" and
  // suppress a real image that does exist for the new tab.
  useEffect(() => setFailed(false), [src]);

  if (failed) return <PlaceholderArt mood={mood} variant={variant} className={className} fit={fit} />;

  return (
    <img
      src={src}
      alt={alt}
      className={`${className} ${fitClass}`}
      onLoad={(e) => onNaturalSize?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
      onError={() => setFailed(true)}
    />
  );
}
