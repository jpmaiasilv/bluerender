import { useEffect, useState } from 'react';

/** Loads a plain HTMLImageElement for Konva's <Image> (which needs a real element, not just a URL) — small enough to not warrant the usual `use-image` package. */
export function useHtmlImage(src: string | null): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!src) {
      setImage(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setImage(img);
    img.src = src;
    return () => {
      img.onload = null;
    };
  }, [src]);

  return image;
}
