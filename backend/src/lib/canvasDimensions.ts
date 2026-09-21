import { EditorFormat, EditorResolution } from '../types/videoEditor';

/** Simplest-integer aspect ratio per fixed format — drives both the export
 * canvas (for non-'auto' formats) and the frontend preview box. */
export const FORMAT_RATIOS: Record<Exclude<EditorFormat, 'auto'>, { w: number; h: number }> = {
  reels: { w: 9, h: 16 },
  feed: { w: 4, h: 5 },
  youtube: { w: 16, h: 9 },
  square: { w: 1, h: 1 },
};

/** Exact pixel dimensions for each fixed format at each resolution tier —
 * matches the table the product spec calls out explicitly. */
const RESOLUTION_TABLE: Record<Exclude<EditorFormat, 'auto'>, Record<'720' | '1080', { w: number; h: number }>> = {
  youtube: { '720': { w: 1280, h: 720 }, '1080': { w: 1920, h: 1080 } },
  reels: { '720': { w: 720, h: 1280 }, '1080': { w: 1080, h: 1920 } },
  feed: { '720': { w: 720, h: 900 }, '1080': { w: 1080, h: 1350 } },
  square: { '720': { w: 720, h: 720 }, '1080': { w: 1080, h: 1080 } },
};

function toEven(n: number): number {
  const rounded = Math.round(n);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

/**
 * Fits `sourceLong`/`sourceShort` (the reference media's own long/short edge)
 * to a target long edge, without upscaling more than 2x — "não fazer upscale
 * absurdo de arquivos muito pequenos" — while still respecting the
 * requested resolution tier in the common case (real footage/photos).
 */
function scaleToLongEdge(sourceLong: number, sourceShort: number, targetLong: number): { long: number; short: number } {
  const cap = Math.max(targetLong, sourceLong); // never reason below the source itself
  const long = Math.min(targetLong, sourceLong * 2, cap);
  const short = long * (sourceShort / sourceLong);
  return { long: toEven(long), short: toEven(short) };
}

export interface ReferenceDimensions {
  width: number;
  height: number;
}

/**
 * Resolves the final export canvas. `reference` is the first visual clip's
 * own pixel dimensions — required when format is 'auto', and also used by
 * 'auto' resolution to avoid upscaling small sources.
 */
export function computeCanvasDimensions(
  format: EditorFormat,
  resolution: EditorResolution,
  reference: ReferenceDimensions | null
): { w: number; h: number } {
  if (format !== 'auto') {
    if (resolution === 'auto') {
      // A "coherent" default for a fixed format: 1080p, unless the source is
      // clearly smaller, in which case fall back to the 720p tier instead of
      // upscaling a small source unnecessarily.
      const sourceLong = reference ? Math.max(reference.width, reference.height) : Infinity;
      return sourceLong >= 1080 ? RESOLUTION_TABLE[format]['1080'] : RESOLUTION_TABLE[format]['720'];
    }
    return RESOLUTION_TABLE[format][resolution];
  }

  // format === 'auto': derive the ratio from the reference media itself.
  const ref = reference && reference.width > 0 && reference.height > 0 ? reference : { width: 9, height: 16 };
  const sourceLong = Math.max(ref.width, ref.height);
  const sourceShort = Math.min(ref.width, ref.height);
  const landscape = ref.width >= ref.height;

  let targetLong: number;
  if (resolution === '720') targetLong = 1280;
  else if (resolution === '1080') targetLong = 1920;
  else targetLong = Math.min(sourceLong, 1920); // 'auto' resolution: preserve source scale, capped at a sane max

  const { long, short } = scaleToLongEdge(sourceLong, sourceShort, targetLong);
  return landscape ? { w: long, h: short } : { w: short, h: long };
}
