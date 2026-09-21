import { getOpenCv } from '../floorplanMask/opencvRuntime';
import { decodeToMat } from '../floorplanMask/imageIO';

/**
 * Validates a generated block PNG before it's ever accepted into the
 * library. Per explicit requirement, an imperfect/missing transparency must
 * be FLAGGED for local handling, never silently accepted as a finished
 * block — a white/opaque background is a rejection, not a "close enough".
 */

export const DEFAULT_MAX_BLOCK_PNG_BYTES = 8 * 1024 * 1024; // 8MB, configurable per call
const CORNER_ALPHA_THRESHOLD = 10; // out of 255 — near-zero, allows for minor compression artifacts
const BORDER_ALPHA_THRESHOLD = 10;
const MAX_REASONABLE_DIMENSION = 4096;

export interface BlockPngValidationResult {
  valid: boolean;
  reasons: string[];
  isPng: boolean;
  hasAlphaChannel: boolean;
  cornersTransparent: boolean;
  objectTouchesBorder: boolean;
  dimensionsValid: boolean;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  withinMaxSize: boolean;
}

/** Reads the PNG signature + IHDR color type directly from the file bytes — a structural, format-level fact (does this PNG format even support an alpha channel) independent of what any individual pixel's alpha value happens to be. Color type 4 (grayscale+alpha) or 6 (truecolor+alpha) means the format has an alpha channel; 0/2/3 do not. */
function readPngColorType(buffer: Buffer): number | null {
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length < 26) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buffer[i] !== PNG_SIGNATURE[i]) return null;
  }
  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType !== 'IHDR') return null;
  return buffer[25];
}

export async function validateBlockImagePng(buffer: Buffer, maxSizeBytes: number = DEFAULT_MAX_BLOCK_PNG_BYTES): Promise<BlockPngValidationResult> {
  const reasons: string[] = [];
  const sizeBytes = buffer.length;
  const withinMaxSize = sizeBytes <= maxSizeBytes;
  if (!withinMaxSize) reasons.push(`file size ${sizeBytes} bytes exceeds the maximum allowed ${maxSizeBytes} bytes`);

  const colorType = readPngColorType(buffer);
  const isPng = colorType !== null;
  if (!isPng) {
    reasons.push('file is not a valid PNG (signature/IHDR check failed)');
    return {
      valid: false,
      reasons,
      isPng: false,
      hasAlphaChannel: false,
      cornersTransparent: false,
      objectTouchesBorder: true,
      dimensionsValid: false,
      width: null,
      height: null,
      sizeBytes,
      withinMaxSize,
    };
  }

  const hasAlphaChannel = colorType === 4 || colorType === 6;
  if (!hasAlphaChannel) reasons.push(`PNG color type ${colorType} has no alpha channel — a transparent background is not even structurally possible`);

  const cv = await getOpenCv();
  let width: number | null = null;
  let height: number | null = null;
  let cornersTransparent = false;
  let objectTouchesBorder = true;
  let dimensionsValid = false;

  try {
    const { mat, width: w, height: h } = await decodeToMat(buffer);
    width = w;
    height = h;
    dimensionsValid = w > 0 && h > 0 && w <= MAX_REASONABLE_DIMENSION && h <= MAX_REASONABLE_DIMENSION;
    if (!dimensionsValid) reasons.push(`dimensions ${w}x${h} are not valid (must be >0 and <=${MAX_REASONABLE_DIMENSION}px)`);

    if (hasAlphaChannel) {
      const channels = new cv.MatVector();
      cv.split(mat, channels);
      const alpha = channels.get(3);

      const corners: [number, number][] = [
        [0, 0],
        [0, w - 1],
        [h - 1, 0],
        [h - 1, w - 1],
      ];
      cornersTransparent = corners.every(([y, x]) => alpha.ucharPtr(y, x)[0] <= CORNER_ALPHA_THRESHOLD);
      if (!cornersTransparent) reasons.push('one or more corners are not transparent — background does not look properly removed');

      // Border check: every pixel along the outermost row/column must be
      // near-transparent, or the object (or an external shadow) is being
      // cropped by the canvas edge.
      let maxBorderAlpha = 0;
      for (let x = 0; x < w; x++) {
        maxBorderAlpha = Math.max(maxBorderAlpha, alpha.ucharPtr(0, x)[0], alpha.ucharPtr(h - 1, x)[0]);
      }
      for (let y = 0; y < h; y++) {
        maxBorderAlpha = Math.max(maxBorderAlpha, alpha.ucharPtr(y, 0)[0], alpha.ucharPtr(y, w - 1)[0]);
      }
      objectTouchesBorder = maxBorderAlpha > BORDER_ALPHA_THRESHOLD;
      if (objectTouchesBorder) reasons.push('object (or its shadow) touches the image border — it may be cropped');

      for (let i = 0; i < channels.size(); i++) channels.get(i).delete();
      channels.delete();
      alpha.delete();
    } else {
      cornersTransparent = false;
      objectTouchesBorder = true;
    }

    mat.delete();
  } catch (err) {
    reasons.push(`failed to decode image for pixel-level checks: ${err instanceof Error ? err.message : String(err)}`);
  }

  const valid = isPng && hasAlphaChannel && cornersTransparent && !objectTouchesBorder && dimensionsValid && withinMaxSize;

  return { valid, reasons, isPng, hasAlphaChannel, cornersTransparent, objectTouchesBorder, dimensionsValid, width, height, sizeBytes, withinMaxSize };
}
