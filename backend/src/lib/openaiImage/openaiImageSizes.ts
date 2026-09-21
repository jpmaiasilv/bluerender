/**
 * OpenAI's image endpoints (images.generate / images.edit) only ever produce
 * a handful of fixed output sizes — this is the one place that enumerates
 * them and picks the nearest one for an arbitrary source aspect ratio.
 * Originally lived only in floorplanCanvas.ts (which still re-exports these
 * names for its existing callers); factored out so any other OpenAI image
 * caller (e.g. the Render IA engine) can reuse it without depending on
 * anything floor-plan-specific.
 */

export type SupportedOutputSize = '1024x1024' | '1536x1024' | '1024x1536';

export const SUPPORTED_OUTPUT_SIZES: ReadonlyArray<{ size: SupportedOutputSize; ratio: number }> = [
  { size: '1024x1024', ratio: 1 },
  { size: '1536x1024', ratio: 1536 / 1024 },
  { size: '1024x1536', ratio: 1024 / 1536 },
];

export function ratioOfSize(size: SupportedOutputSize): number {
  return SUPPORTED_OUTPUT_SIZES.find((s) => s.size === size)!.ratio;
}

/** Nearest supported size by aspect-ratio distance measured on a log scale (so 2:1 and 1:2 are treated symmetrically). */
export function pickNearestSize(width: number, height: number): SupportedOutputSize {
  const r = Math.log(width / height);
  let best = SUPPORTED_OUTPUT_SIZES[0];
  let bestDistance = Infinity;
  for (const candidate of SUPPORTED_OUTPUT_SIZES) {
    const d = Math.abs(r - Math.log(candidate.ratio));
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best.size;
}
