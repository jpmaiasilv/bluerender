import { getOpenCv, OpenCv } from './opencvRuntime';
import { encodeMatToPng } from './imageIO';

type Mat = InstanceType<OpenCv['Mat']>;

/**
 * Scopes FLUX.1 Fill generation to the actual drawn area of the floor plan
 * — requirement: "O FLUX não deve editar as grandes áreas brancas externas
 * à planta" (confirmed as a real failure mode by the 2026-09-19 real run:
 * FLUX hallucinated a fake logo and garbled text in the large blank
 * title-block/elevation margins, which the mask alone marked "editable"
 * but which are never meant to receive AI-generated content at all).
 *
 * Deliberately a SEPARATE module from lib/floorplanFurniture/usefulAreaDetection.ts
 * (same "find the drawn content" algorithm, intentionally duplicated, not
 * imported) — that module belongs to the OpenAI furniture-recognition
 * pipeline, which this fix must not touch or depend on; this module has
 * zero import relationship with it.
 */

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Finds the bounding box of the actually-drawn content (ink), expanded by
 * `marginPx` on every side (clamped to the image bounds) — pure pixel
 * analysis, no AI. A blank image or a drawing that already fills the frame
 * returns the whole image, so this never shrinks a plan that has no real
 * margin to begin with.
 */
export async function detectDrawnAreaBoundingBox(rgba: Mat, marginPx: number): Promise<PixelRect> {
  const cv = await getOpenCv();
  const width = rgba.cols;
  const height = rgba.rows;

  const gray = new cv.Mat();
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);

  // Anything meaningfully darker than paper-white counts as "content" —
  // deliberately a loose threshold (not Otsu), a rough ink bounding box is
  // all that's needed here.
  const nonWhite = new cv.Mat();
  cv.threshold(gray, nonWhite, 245, 255, cv.THRESH_BINARY_INV);

  // Close small gaps between nearby strokes so the bounding box isn't
  // fragmented by isolated dots (e.g. a stray dimension tick mark far from
  // the main drawing would otherwise force the box needlessly wide).
  const closeKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
  const closed = new cv.Mat();
  cv.morphologyEx(nonWhite, closed, cv.MORPH_CLOSE, closeKernel);

  const nonZeroCount = cv.countNonZero(closed);
  let rect: PixelRect;
  if (nonZeroCount === 0) {
    rect = { x: 0, y: 0, width, height };
  } else {
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const bounding = cv.boundingRect(contour);
      minX = Math.min(minX, bounding.x);
      minY = Math.min(minY, bounding.y);
      maxX = Math.max(maxX, bounding.x + bounding.width);
      maxY = Math.max(maxY, bounding.y + bounding.height);
      contour.delete();
    }
    contours.delete();
    hierarchy.delete();

    if (maxX <= minX || maxY <= minY) {
      rect = { x: 0, y: 0, width, height };
    } else {
      const x0 = Math.max(0, minX - marginPx);
      const y0 = Math.max(0, minY - marginPx);
      const x1 = Math.min(width, maxX + marginPx);
      const y1 = Math.min(height, maxY + marginPx);
      rect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }
  }

  gray.delete();
  nonWhite.delete();
  closeKernel.delete();
  closed.delete();

  return rect;
}

export interface UsefulAreaCrop {
  rect: PixelRect;
  imageCropPng: Buffer;
  /** Same fill-mask convention as the rest of the pipeline: white=editable, black=protected — cropped from the SAME full-size fill mask, so protection of walls/furniture/text WITHIN the crop is unchanged; only WHERE FLUX is even allowed to look changes. */
  maskCropPng: Buffer;
}

/** Crops both the source image and its already-computed, full-size fill mask to the same rect. */
export async function extractUsefulAreaCrop(originalRgba: Mat, fillMaskFullSize: Mat, rect: PixelRect): Promise<UsefulAreaCrop> {
  const cv = await getOpenCv();

  const imageRoi = originalRgba.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height));
  const imageCrop = new cv.Mat();
  imageRoi.copyTo(imageCrop);
  imageRoi.delete();

  const maskRoi = fillMaskFullSize.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height));
  const maskCrop = new cv.Mat();
  maskRoi.copyTo(maskCrop);
  maskRoi.delete();

  const imageCropPng = await encodeMatToPng(imageCrop);
  const maskCropPng = await encodeMatToPng(maskCrop);
  imageCrop.delete();
  maskCrop.delete();

  return { rect, imageCropPng, maskCropPng };
}

/**
 * Pastes `resultCropRgba` (already resized to exactly rect.width x
 * rect.height by the caller — see forceOriginalDimensions in
 * floorplanValidation.ts) onto a full-size COPY of `originalRgba`. Outside
 * `rect`, the returned Mat is byte-identical to `originalRgba` — FLUX never
 * saw that region, so there is nothing for it to have altered there. The
 * returned Mat always has the exact same dimensions as `originalRgba`.
 */
export async function recomposeOntoOriginalCanvas(originalRgba: Mat, resultCropRgba: Mat, rect: PixelRect): Promise<Mat> {
  const cv = await getOpenCv();
  const canvas = new cv.Mat();
  originalRgba.copyTo(canvas);
  const roi = canvas.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height));
  resultCropRgba.copyTo(roi);
  roi.delete();
  return canvas;
}
