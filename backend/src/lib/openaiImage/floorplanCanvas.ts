import { Jimp } from 'jimp';
import sizeOf from 'image-size';
import { HUMANIZED_FLOORPLAN_OUTPUT_FORMAT_SIZES, HumanizedFloorplanOutputFormat } from '../../config/humanizedFloorplanSimpleStyles';
import { SUPPORTED_OUTPUT_SIZES, SupportedOutputSize, pickNearestSize, ratioOfSize } from './openaiImageSizes';

// Re-exported for this module's existing callers (see openaiImageSizes.ts for the actual definitions).
export { SUPPORTED_OUTPUT_SIZES, SupportedOutputSize, pickNearestSize, ratioOfSize };

/**
 * Keeps the plan's GEOMETRY intact on its way to the image model.
 *
 * The image API only produces a few fixed output sizes. Sending a plan whose
 * aspect ratio differs from the chosen size invites the model to stretch,
 * squeeze or crop it. So both generation modes:
 *   1. detect the plan's aspect ratio,
 *   2. pick the supported size whose ratio is closest (or the user's explicit
 *      "Quadrado / Paisagem / Retrato"),
 *   3. place the untouched plan, centered, on a canvas of EXACTLY that ratio,
 *      filling only the extra area with a neutral margin colour.
 * The plan itself is never resampled, stretched, compressed or cropped.
 */

/** A ratio within this relative tolerance of the target needs no margin (sub-pixel rounding noise). */
const RATIO_TOLERANCE = 0.005;
const WHITE = { r: 255, g: 255, b: 255 };

export interface PreparedCanvas {
  /** What is sent to the model as the plan (the original bytes when no margin was needed). */
  buffer: Buffer;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  size: SupportedOutputSize;
  /** True when neutral margins were added (the plan sits centered on a larger canvas). */
  padded: boolean;
  /** The plan's own pixel size and where it sits on the canvas — the plan is never resized. */
  plan: { width: number; height: number };
  canvas: { width: number; height: number };
  offset: { x: number; y: number };
  marginColor: { r: number; g: number; b: number } | null;
}

/** Most common colour along the border (the drawing's own background), or white when the border is not clearly uniform. */
interface PixelSource {
  width: number;
  height: number;
  getPixelColor(x: number, y: number): number;
}

function neutralMarginColor(img: PixelSource): { r: number; g: number; b: number } {
  const w = img.width;
  const h = img.height;
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  let samples = 0;
  const stepX = Math.max(1, Math.floor(w / 400));
  const stepY = Math.max(1, Math.floor(h / 400));
  const take = (x: number, y: number) => {
    const c = img.getPixelColor(x, y);
    const r = (c >>> 24) & 0xff;
    const g = (c >>> 16) & 0xff;
    const b = (c >>> 8) & 0xff;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const cur = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    cur.count++;
    cur.r += r;
    cur.g += g;
    cur.b += b;
    buckets.set(key, cur);
    samples++;
  };
  for (let x = 0; x < w; x += stepX) {
    take(x, 0);
    take(x, h - 1);
  }
  for (let y = 0; y < h; y += stepY) {
    take(0, y);
    take(w - 1, y);
  }
  let top: { count: number; r: number; g: number; b: number } | null = null;
  for (const b of buckets.values()) if (!top || b.count > top.count) top = b;
  if (!top || top.count / Math.max(1, samples) < 0.6) return WHITE;
  return { r: Math.round(top.r / top.count), g: Math.round(top.g / top.count), b: Math.round(top.b / top.count) };
}

/** Explicit user format wins; otherwise the size nearest to the plan's own ratio. */
export function chooseOutputSize(width: number, height: number, outputFormat: HumanizedFloorplanOutputFormat): SupportedOutputSize {
  return HUMANIZED_FLOORPLAN_OUTPUT_FORMAT_SIZES[outputFormat] ?? pickNearestSize(width, height);
}

/**
 * Builds the model input. Falls back to the original bytes (still with the
 * nearest size) only when the image cannot be decoded here (e.g. WEBP, which the
 * frontend converts to PNG before upload) — then no margin can be added.
 */
export async function prepareFloorplanCanvas(buffer: Buffer, mime: PreparedCanvas['mime'], outputFormat: HumanizedFloorplanOutputFormat): Promise<PreparedCanvas> {
  let decoded: Awaited<ReturnType<typeof Jimp.read>> | null = null;
  if (mime !== 'image/webp') {
    try {
      decoded = await Jimp.read(buffer);
    } catch {
      decoded = null;
    }
  }

  if (!decoded) {
    let dims: { width?: number; height?: number } = {};
    try {
      dims = sizeOf(buffer);
    } catch {
      dims = {};
    }
    const w = dims.width ?? 1;
    const h = dims.height ?? 1;
    return { buffer, mime, size: chooseOutputSize(w, h, outputFormat), padded: false, plan: { width: w, height: h }, canvas: { width: w, height: h }, offset: { x: 0, y: 0 }, marginColor: null };
  }

  const w = decoded.width;
  const h = decoded.height;
  const size = chooseOutputSize(w, h, outputFormat);
  const target = ratioOfSize(size);
  const current = w / h;

  if (Math.abs(current - target) / target <= RATIO_TOLERANCE) {
    return { buffer, mime, size, padded: false, plan: { width: w, height: h }, canvas: { width: w, height: h }, offset: { x: 0, y: 0 }, marginColor: null };
  }

  // Flatten any transparency on white so the plan is opaque, THEN measure its background for the margins.
  const flat = new Jimp({ width: w, height: h, color: 0xffffffff });
  flat.composite(decoded, 0, 0);
  const fill = neutralMarginColor(flat);

  let canvasW = w;
  let canvasH = h;
  if (current < target) canvasW = Math.ceil(h * target); // too tall/narrow: widen the canvas
  else canvasH = Math.ceil(w / target); // too wide/short: heighten the canvas
  const offsetX = Math.floor((canvasW - w) / 2);
  const offsetY = Math.floor((canvasH - h) / 2);

  const rgba = (((fill.r << 24) | (fill.g << 16) | (fill.b << 8) | 0xff) >>> 0) as number;
  const canvas = new Jimp({ width: canvasW, height: canvasH, color: rgba });
  canvas.composite(flat, offsetX, offsetY);
  const out = Buffer.from(await canvas.getBuffer('image/png'));

  return { buffer: out, mime: 'image/png', size, padded: true, plan: { width: w, height: h }, canvas: { width: canvasW, height: canvasH }, offset: { x: offsetX, y: offsetY }, marginColor: fill };
}
