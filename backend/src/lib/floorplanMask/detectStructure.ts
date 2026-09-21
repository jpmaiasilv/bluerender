import { getOpenCv, OpenCv } from './opencvRuntime';

type Mat = InstanceType<OpenCv['Mat']>;

export interface StructureDetection {
  /** Long straight segments — walls, columns' straight edges, and (as a side effect, since door/window frames are drawn with the same kind of line) most openings' frames and the building's external outline. */
  wallsMask: Mat;
  /** Mid-sized closed/solid contours — existing furniture blocks, fixtures and small filled shapes such as columns. */
  furnitureMask: Mat;
  /** Small, dense dark marks — room numbers, dimension figures ("320", "A: 13,00 m²") and similar embedded text/technical symbols. Detected by size/shape heuristics, not OCR (no text-reading model is used, per the "no LLM for contour drawing" constraint) — see the module doc comment for what this does and doesn't catch. */
  textMask: Mat;
  /** Curved segments — door-swing arcs and similar non-straight technical marks, which the straight-line Hough pass above cannot catch. Best-effort: HoughCircles is built for full circles, so a partial arc is only found when enough of its curvature is present in the edge map. This is the least reliable of the four detectors and the one most worth checking by eye against a real plan. */
  archesMask: Mat;
  /** Union of the four above, before the safety-margin dilation applied in buildMask.ts. */
  combinedMask: Mat;
  /** Raw counts behind each mask, purely informational (e.g. for inspection reports) — reading these never changes detection behavior, they're just exposed alongside the masks that were already being computed. */
  counts: {
    /** Number of individual Hough line segments found (before being merged/thickened into wallsMask). */
    wallLineSegments: number;
    /** Number of contours accepted as furniture-sized solid blocks. */
    furnitureContours: number;
    /** Number of connected components accepted as text/dimension-sized marks. */
    textComponents: number;
    /** Number of circles found by the arc/door-swing detector. */
    arcCandidates: number;
  };
}

// Tuned against 1600px-long-side working images (see preprocess.ts).
const WALL_MIN_LINE_LENGTH = 40;
const WALL_MAX_LINE_GAP = 8;
const WALL_LINE_THICKNESS = 5; // how wide to draw each detected wall segment into the mask

const FURNITURE_MIN_AREA_RATIO = 0.0015; // ~0.15% of the image — filters out noise/text
const FURNITURE_MAX_AREA_RATIO = 0.12; // filters out whole-room-sized false positives

const TEXT_MIN_AREA = 6;
const TEXT_MAX_AREA = 350;
const TEXT_MAX_ASPECT_RATIO = 6; // rules out long thin lines (already handled as walls) being mistaken for text

const ARC_MIN_RADIUS = 12;
const ARC_MAX_RADIUS = 70;
const ARC_LINE_THICKNESS = 4;

/**
 * Small, dark, roughly-text-sized marks — reusable both for the original
 * image's own text/dimension detection (detectStructure below) and for the
 * post-generation "did the model invent new text?" check in
 * floorplanValidation.ts, which runs the exact same heuristic on the
 * generated image and only flags blobs that land OUTSIDE the protected
 * region (i.e. text that wasn't there to protect in the first place).
 */
export async function detectTextLikeMask(gray: Mat, enhanced: Mat, excludeMask?: Mat): Promise<Mat> {
  const cv = await getOpenCv();
  const width = gray.cols;
  const height = gray.rows;

  const thresh = new cv.Mat();
  cv.threshold(enhanced, thresh, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

  let candidates = thresh;
  if (excludeMask) {
    const notExcluded = new cv.Mat();
    cv.bitwise_not(excludeMask, notExcluded);
    candidates = new cv.Mat();
    cv.bitwise_and(thresh, notExcluded, candidates);
    notExcluded.delete();
  }

  const labels = new cv.Mat();
  const stats = new cv.Mat();
  const centroids = new cv.Mat();
  const numLabels = cv.connectedComponentsWithStats(candidates, labels, stats, centroids, 8, cv.CV_32S);

  const textMask = cv.Mat.zeros(height, width, cv.CV_8UC1);
  for (let label = 1; label < numLabels; label++) {
    const x = stats.intAt(label, cv.CC_STAT_LEFT);
    const y = stats.intAt(label, cv.CC_STAT_TOP);
    const w = stats.intAt(label, cv.CC_STAT_WIDTH);
    const h = stats.intAt(label, cv.CC_STAT_HEIGHT);
    const compArea = stats.intAt(label, cv.CC_STAT_AREA);
    const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));
    if (compArea >= TEXT_MIN_AREA && compArea <= TEXT_MAX_AREA && aspect <= TEXT_MAX_ASPECT_RATIO) {
      cv.rectangle(textMask, new cv.Point(x, y), new cv.Point(x + w, y + h), new cv.Scalar(255), -1);
    }
  }

  thresh.delete();
  if (excludeMask) candidates.delete();
  labels.delete();
  stats.delete();
  centroids.delete();

  return textMask;
}

/** Number of connected components in `mask` — used to turn a text-like mask into a simple "how many suspicious blobs" count for floorplanValidation.ts. */
export async function countBlobs(mask: Mat): Promise<number> {
  const cv = await getOpenCv();
  const labels = new cv.Mat();
  const numLabels = cv.connectedComponents(mask, labels, 8, cv.CV_32S);
  labels.delete();
  return Math.max(0, numLabels - 1); // label 0 is the background
}

/**
 * Classical CV structure detection — no language/vision model classifies or
 * draws anything here (per explicit requirement): every region comes from
 * Canny edges, Hough line transforms, contour/connected-component analysis
 * and size/shape heuristics tuned for architectural floor plan drawings.
 *
 * This intentionally does NOT attempt to semantically tell a door apart
 * from a window, or name which furniture piece is which — it only decides
 * "this pixel region is structure/existing content that must not move" vs
 * "this pixel region is open floor/background that the render may touch".
 * That coarser signal is exactly what a Fill mask needs.
 */
export async function detectStructure(gray: Mat, enhanced: Mat): Promise<StructureDetection> {
  const cv = await getOpenCv();
  const width = gray.cols;
  const height = gray.rows;
  const area = width * height;

  // --- Walls: Canny edges -> probabilistic Hough transform, keep only long segments. ---
  // Deliberately runs on the plain grayscale, NOT the CLAHE-enhanced image:
  // CLAHE's adaptive per-tile contrast shifts slightly depending on what
  // else is in each tile (furniture blocks, text), which was observed to
  // occasionally push a real wall edge below Canny's threshold in one tile
  // while leaving it detected elsewhere — wall lines in real technical
  // drawings already have strong, consistent contrast and don't need
  // adaptive enhancement to be found. `enhanced` is still used below for
  // furniture/text thresholding, where local contrast variation helps.
  // Canny thresholds derived from the image's own Otsu threshold rather than
  // fixed constants: a stark black-on-white technical drawing (the expected
  // real input) and a softer, anti-aliased or colorized render need very
  // different absolute thresholds to both produce clean edges — the classic
  // "high = Otsu, low = 0.5 * high" heuristic adapts to whichever the actual
  // upload turns out to be instead of assuming one specific contrast level.
  const otsuProbe = new cv.Mat();
  const otsuThreshold = cv.threshold(gray, otsuProbe, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  otsuProbe.delete();
  const highThreshold = Math.max(50, otsuThreshold);
  const lowThreshold = highThreshold * 0.5;

  const edges = new cv.Mat();
  cv.Canny(gray, edges, lowThreshold, highThreshold);

  const lines = new cv.Mat();
  cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 40, WALL_MIN_LINE_LENGTH, WALL_MAX_LINE_GAP);

  // This @techstark/opencv-js build returns HoughLinesP's result as a
  // (rows=1, cols=N, channels=4) Mat — the segment COUNT is `lines.cols`,
  // not `lines.rows` (which is always 1). Same convention already used
  // correctly for HoughCircles below (`circles.cols`). Confirmed via
  // scripts/inspect-real-floorplan.ts against a real technical drawing: the
  // small synthetic unit-test fixture never exposed this because iterating
  // `lines.rows` (=1) still happened to draw a real wall segment on that
  // simple image, masking the bug there.
  const wallsMask = cv.Mat.zeros(height, width, cv.CV_8UC1);
  for (let i = 0; i < lines.cols; i++) {
    const [x1, y1, x2, y2] = lines.data32S.subarray(i * 4, i * 4 + 4);
    cv.line(wallsMask, new cv.Point(x1, y1), new cv.Point(x2, y2), new cv.Scalar(255), WALL_LINE_THICKNESS, cv.LINE_8);
  }

  // --- Furniture / solid blocks: threshold + closed contours in a plausible size band. ---
  const thresh = new cv.Mat();
  cv.threshold(enhanced, thresh, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

  const closed = new cv.Mat();
  const closeKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  cv.morphologyEx(thresh, closed, cv.MORPH_CLOSE, closeKernel);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const furnitureMask = cv.Mat.zeros(height, width, cv.CV_8UC1);
  let furnitureContours = 0;
  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const contourArea = cv.contourArea(contour);
    const ratio = contourArea / area;
    if (ratio >= FURNITURE_MIN_AREA_RATIO && ratio <= FURNITURE_MAX_AREA_RATIO) {
      const filled = new cv.MatVector();
      filled.push_back(contour);
      cv.drawContours(furnitureMask, filled, 0, new cv.Scalar(255), -1);
      filled.delete();
      furnitureContours++;
    }
    contour.delete();
  }

  // --- Text / dimension marks: reuses the same heuristic the post-generation suspicious-text check uses, excluding anything already claimed as a wall. ---
  const textMask = await detectTextLikeMask(gray, enhanced, wallsMask);

  // --- Arcs / curves: door-swing arcs and similar curved technical symbols
  // that neither the straight-line Hough pass nor the filled-contour pass
  // above can catch. HoughCircles looks for FULL circles, so a partial arc
  // is only found when enough of its curvature is present — best-effort,
  // the least reliable detector here (see StructureDetection's doc comment).
  const archesMask = cv.Mat.zeros(height, width, cv.CV_8UC1);
  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
  const circles = new cv.Mat();
  cv.HoughCircles(blurred, circles, cv.HOUGH_GRADIENT, 1, ARC_MIN_RADIUS, highThreshold, 30, ARC_MIN_RADIUS, ARC_MAX_RADIUS);
  const arcCandidates = circles.cols;
  for (let i = 0; i < circles.cols; i++) {
    const cx = circles.data32F[i * 3];
    const cy = circles.data32F[i * 3 + 1];
    const radius = circles.data32F[i * 3 + 2];
    cv.circle(archesMask, new cv.Point(cx, cy), radius, new cv.Scalar(255), ARC_LINE_THICKNESS);
  }
  blurred.delete();
  circles.delete();

  const textComponents = await countBlobs(textMask);

  const combinedMask = new cv.Mat();
  cv.bitwise_or(wallsMask, furnitureMask, combinedMask);
  cv.bitwise_or(combinedMask, textMask, combinedMask);
  cv.bitwise_or(combinedMask, archesMask, combinedMask);

  const wallLineSegments = lines.cols;

  edges.delete();
  lines.delete();
  thresh.delete();
  closed.delete();
  closeKernel.delete();
  contours.delete();
  hierarchy.delete();

  return {
    wallsMask,
    furnitureMask,
    textMask,
    archesMask,
    combinedMask,
    counts: { wallLineSegments, furnitureContours, textComponents, arcCandidates },
  };
}
