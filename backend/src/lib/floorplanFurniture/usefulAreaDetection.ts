import { getOpenCv, OpenCv } from '../floorplanMask/opencvRuntime';
import { GEMINI_VISION_USEFUL_AREA_MARGIN_PX } from '../../config/geminiVisionEngine';
import { PixelRect } from './types';

type Mat = InstanceType<OpenCv['Mat']>;

/**
 * Finds the bounding box of the actually-drawn content in a floor plan that
 * has a lot of surrounding white margin (common in exported/printed sheets)
 * — so the overview/tiles sent to Gemini aren't mostly blank page. Pure
 * pixel analysis, no AI involved, consistent with the rest of this
 * project's "classical CV first" approach to anything that doesn't need
 * semantic understanding.
 */
export async function detectUsefulArea(rgba: Mat, marginPx: number = GEMINI_VISION_USEFUL_AREA_MARGIN_PX): Promise<PixelRect> {
  const cv = await getOpenCv();
  const width = rgba.cols;
  const height = rgba.rows;

  const gray = new cv.Mat();
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);

  // Anything meaningfully darker than paper-white counts as "content" —
  // deliberately a loose threshold (not Otsu) since we only need a rough
  // ink bounding box here, not clean edges.
  const nonWhite = new cv.Mat();
  cv.threshold(gray, nonWhite, 245, 255, cv.THRESH_BINARY_INV);

  // Close small gaps between nearby strokes so the bounding box isn't
  // fragmented by isolated dots (e.g. dimension tick marks far from the
  // main drawing would otherwise force the box needlessly wide).
  const closeKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
  const closed = new cv.Mat();
  cv.morphologyEx(nonWhite, closed, cv.MORPH_CLOSE, closeKernel);

  const nonZeroCount = cv.countNonZero(closed);
  let rect: PixelRect;
  if (nonZeroCount === 0) {
    // Blank image — the "useful area" is just the whole image.
    rect = { x: 0, y: 0, width, height };
  } else {
    // cv.findNonZero isn't exposed by this WASM build (unlike native
    // OpenCV) — findContours + a union of each contour's bounding rect is
    // the supported equivalent, and this codebase already relies on
    // findContours elsewhere (detectStructure.ts), so it's a proven path.
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
