import { getOpenCv, OpenCv } from './opencvRuntime';
import { PixelRect } from './usefulAreaCrop';

type Mat = InstanceType<OpenCv['Mat']>;

/**
 * Groups the individual, glyph/character-sized components detectStructure.ts's
 * detectTextLikeMask() finds into WORD/LABEL-sized regions — requirement:
 * "não dependa apenas de componentes pequenos isolados... preserve palavras
 * completas e suas áreas vizinhas." A single dimension figure or room label
 * ("A: 13,00 m²") is normally several disconnected glyph components; treating
 * each one as its own tiny protected rectangle (the pre-existing behavior,
 * still used as-is for the post-generation hallucination CANDIDATE detector
 * in floorplanValidation.ts) leaves gaps between characters that aren't
 * protected and can't be cleanly restored as one coherent label afterward.
 *
 * Pure pixel/geometry operation — no AI, no network — operates on
 * detectStructure.ts's own textMask verbatim, never modifying that module.
 */

/** Merges glyphs into words/lines: wide enough to bridge normal character/word spacing, short enough to not merge separate table rows or unrelated labels above/below each other. Tuned against 1600px-long-side working images (see preprocess.ts), matching the scale detectStructure.ts's own text-size thresholds are tuned for. */
const GROUPING_DILATE_WIDTH_PX = 25;
const GROUPING_DILATE_HEIGHT_PX = 7;

export async function groupTextRegions(textMask: Mat, marginPx: number): Promise<{ mask: Mat; regions: PixelRect[] }> {
  const cv = await getOpenCv();
  const width = textMask.cols;
  const height = textMask.rows;

  const nonZero = cv.countNonZero(textMask);
  if (nonZero === 0) {
    return { mask: cv.Mat.zeros(height, width, cv.CV_8UC1), regions: [] };
  }

  const dilateKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(GROUPING_DILATE_WIDTH_PX, GROUPING_DILATE_HEIGHT_PX));
  const grouped = new cv.Mat();
  cv.dilate(textMask, grouped, dilateKernel);
  dilateKernel.delete();

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(grouped, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  grouped.delete();

  const regions: PixelRect[] = [];
  const mask = cv.Mat.zeros(height, width, cv.CV_8UC1);
  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const rect = cv.boundingRect(contour);
    contour.delete();

    const x0 = Math.max(0, rect.x - marginPx);
    const y0 = Math.max(0, rect.y - marginPx);
    const x1 = Math.min(width, rect.x + rect.width + marginPx);
    const y1 = Math.min(height, rect.y + rect.height + marginPx);
    if (x1 <= x0 || y1 <= y0) continue;

    const region: PixelRect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    regions.push(region);
    cv.rectangle(mask, new cv.Point(region.x, region.y), new cv.Point(region.x + region.width, region.y + region.height), new cv.Scalar(255), -1);
  }
  contours.delete();
  hierarchy.delete();

  return { mask, regions };
}

/** Scales a list of regions from WORKING-resolution pixels to ORIGINAL-image pixels (see preprocess.ts's WorkingImage.scaleToOriginal) and clamps to the original image bounds. */
export function scaleRegionsToOriginal(regions: PixelRect[], scaleToOriginal: number, originalWidth: number, originalHeight: number): PixelRect[] {
  return regions.map((r) => {
    const x0 = Math.max(0, Math.min(originalWidth, Math.floor(r.x * scaleToOriginal)));
    const y0 = Math.max(0, Math.min(originalHeight, Math.floor(r.y * scaleToOriginal)));
    const x1 = Math.max(x0, Math.min(originalWidth, Math.ceil((r.x + r.width) * scaleToOriginal)));
    const y1 = Math.max(y0, Math.min(originalHeight, Math.ceil((r.y + r.height) * scaleToOriginal)));
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  });
}
