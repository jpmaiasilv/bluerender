import { AspectRatioOption } from '../types/api';
import { T2IAspectRatio } from '../types/textToImage';

const MAX_PIXELS = 4_000_000; // BFL FLUX.2 output limit
const DIMENSION_MULTIPLE = 16; // BFL requires width/height to be multiples of 16
const MIN_DIMENSION = 64;

function roundToMultiple(value: number): number {
  // Floor (not round) so a rounded-up dimension can never push the total back over MAX_PIXELS.
  return Math.max(MIN_DIMENSION, Math.floor(value / DIMENSION_MULTIPLE) * DIMENSION_MULTIPLE);
}

/**
 * Scales the source image's dimensions down to fit BFL's 4MP limit while
 * preserving aspect ratio, then rounds to the required multiple of 16.
 */
export function computeTargetDimensions(
  sourceWidth: number,
  sourceHeight: number
): { width: number; height: number } {
  let width = sourceWidth;
  let height = sourceHeight;

  if (width * height > MAX_PIXELS) {
    const scale = Math.sqrt(MAX_PIXELS / (width * height));
    width *= scale;
    height *= scale;
  }

  return { width: roundToMultiple(width), height: roundToMultiple(height) };
}

const MANUAL_RATIOS: Record<Exclude<AspectRatioOption, 'automatic'>, [number, number]> = {
  '16:9': [16, 9],
  '4:3': [4, 3],
  '3:2': [3, 2],
  '1:1': [1, 1],
  '9:16': [9, 16],
};

/**
 * "Automatic" preserves the source image's own aspect ratio exactly (via
 * computeTargetDimensions). A manual ratio reshapes the output canvas to that
 * ratio, but keeps roughly the same total pixel budget as the source image —
 * it never simply stretches the source to fit, which is left to the prompt's
 * "don't distort, extend the scene instead" instruction (see promptBuilder).
 */
export function computeDimensionsForAspectRatio(
  sourceWidth: number,
  sourceHeight: number,
  aspectRatio: AspectRatioOption
): { width: number; height: number } {
  if (aspectRatio === 'automatic') {
    return computeTargetDimensions(sourceWidth, sourceHeight);
  }

  const [ratioW, ratioH] = MANUAL_RATIOS[aspectRatio];
  const pixelBudget = Math.min(sourceWidth * sourceHeight, MAX_PIXELS);
  const width = Math.sqrt(pixelBudget * (ratioW / ratioH));
  const height = width * (ratioH / ratioW);

  return computeTargetDimensions(width, height);
}

const T2I_DEFAULT_PIXEL_BUDGET = 1_048_576; // ~1MP — there is no source image to derive a budget from

const T2I_MANUAL_RATIOS: Record<Exclude<T2IAspectRatio, 'automatic'>, [number, number]> = {
  '16:9': [16, 9],
  '4:3': [4, 3],
  '3:2': [3, 2],
  '1:1': [1, 1],
  '9:16': [9, 16],
  '2:3': [2, 3],
};

/**
 * Text-to-image has no source image to preserve or scale from, so "Automatic"
 * simply omits width/height and lets the model pick its own default canvas.
 * A manual ratio gets a fixed ~1MP pixel budget (a sensible default resolution
 * for concept visualization, well under BFL's 4MP ceiling) reshaped to that ratio.
 */
export function computeDimensionsForTextToImage(
  aspectRatio: T2IAspectRatio
): { width: number; height: number } | null {
  if (aspectRatio === 'automatic') return null;

  const [ratioW, ratioH] = T2I_MANUAL_RATIOS[aspectRatio];
  const width = Math.sqrt(T2I_DEFAULT_PIXEL_BUDGET * (ratioW / ratioH));
  const height = width * (ratioH / ratioW);

  return computeTargetDimensions(width, height);
}
