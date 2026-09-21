import { getOpenCv, OpenCv } from '../floorplanMask/opencvRuntime';
import { encodeMatToPng } from '../floorplanMask/imageIO';
import { GEMINI_VISION_MAX_IMAGE_DIMENSION } from '../../config/geminiVisionEngine';
import { PixelRect, SourceCrop } from './types';

type Mat = InstanceType<OpenCv['Mat']>;

export interface ExtractedCrop {
  crop: SourceCrop;
  pngBuffer: Buffer;
}

/**
 * Cuts `rect` out of `rgba` and, only if it's larger than
 * GEMINI_VISION_MAX_IMAGE_DIMENSION on its long side, downscales it before
 * encoding — never upscales, and the resize factor is recorded on the
 * returned SourceCrop (sentWidth/sentHeight) so coordinateTransform.ts can
 * map Gemini's normalized coordinates back exactly, regardless of whether a
 * resize happened. Per requirement, the resize threshold is deliberately
 * generous (1536px) so small furniture/text stays legible.
 */
export async function extractCrop(rgba: Mat, rect: PixelRect, id: string): Promise<ExtractedCrop> {
  const cv = await getOpenCv();

  const roi = rgba.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height));
  const cropped = new cv.Mat();
  roi.copyTo(cropped);
  roi.delete();

  const longSide = Math.max(cropped.cols, cropped.rows);
  let sent = cropped;
  let didResize = false;
  if (longSide > GEMINI_VISION_MAX_IMAGE_DIMENSION) {
    const scale = GEMINI_VISION_MAX_IMAGE_DIMENSION / longSide;
    const targetWidth = Math.max(1, Math.round(cropped.cols * scale));
    const targetHeight = Math.max(1, Math.round(cropped.rows * scale));
    const resized = new cv.Mat();
    cv.resize(cropped, resized, new cv.Size(targetWidth, targetHeight), 0, 0, cv.INTER_AREA);
    sent = resized;
    didResize = true;
  }

  const pngBuffer = await encodeMatToPng(sent);

  const sourceCrop: SourceCrop = {
    id,
    rectInOriginal: rect,
    sentWidth: sent.cols,
    sentHeight: sent.rows,
  };

  if (didResize) sent.delete();
  cropped.delete();

  return { crop: sourceCrop, pngBuffer };
}
