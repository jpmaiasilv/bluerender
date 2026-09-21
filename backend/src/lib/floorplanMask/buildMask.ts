import { getOpenCv, OpenCv } from './opencvRuntime';
import { decodeToMat, encodeMatToPng } from './imageIO';
import { buildWorkingImage } from './preprocess';
import { detectStructure } from './detectStructure';
import { groupTextRegions, scaleRegionsToOriginal } from './textGrouping';
import { PixelRect } from './usefulAreaCrop';
import { HUMANIZED_FLOORPLAN_DEFAULT_SAFETY_MARGIN_PX, HUMANIZED_FLOORPLAN_TEXT_GROUP_MARGIN_PX } from '../../config/humanizedFloorplanEngine';

type Mat = InstanceType<OpenCv['Mat']>;

export interface FloorplanMaskResult {
  /** protected=255, editable=0, at the ORIGINAL image's resolution — the form used internally for the post-generation comparison in floorplanValidation.ts. */
  protectedMask: Mat;
  /** Wall lines only (not furniture/text), at the ORIGINAL image's resolution — used by floorplanValidation.ts's pixel-exact wall-line overlay (step 2 of requirement #8), kept separate from `protectedMask` because that overlay is deliberately narrower than the full protected region. */
  wallsMaskOriginalRes: Mat;
  /** Grouped+margin-expanded text/label regions only (not walls/furniture), at the ORIGINAL image's resolution — used by floorplanValidation.ts's pixel-exact text restoration (lib/floorplanMask/textGrouping.ts), kept separate from `protectedMask` for the same reason wallsMaskOriginalRes is. */
  textProtectionMaskOriginalRes: Mat;
  /** The same regions as `textProtectionMaskOriginalRes`, as a plain rect list — used for per-region restoration bookkeeping and private diagnostics. */
  textRegions: PixelRect[];
  /** The BFL Fill-ready PNG: black=protected, white=editable, same dimensions as the original image. */
  maskPng: Buffer;
  originalWidth: number;
  originalHeight: number;
}

/**
 * End-to-end: decode -> working-resolution preprocessing -> classical-CV
 * structure detection -> safety margin -> resize back to the original
 * image's exact dimensions -> BFL Fill mask convention (black=preserve).
 *
 * Pure function of the input image bytes — no network calls, no AI model,
 * fully unit-testable offline (see floorplanMask tests).
 */
export async function buildFloorplanMask(
  imageBuffer: Buffer,
  safetyMarginPx: number = HUMANIZED_FLOORPLAN_DEFAULT_SAFETY_MARGIN_PX
): Promise<FloorplanMaskResult> {
  const cv = await getOpenCv();
  const { mat: rgba, width, height } = await decodeToMat(imageBuffer);

  const { gray, enhanced, scaleToOriginal } = await buildWorkingImage(rgba, width, height);
  const detection = await detectStructure(gray, enhanced);

  // --- Group detectStructure.ts's glyph-sized text components into
  // word/label-sized regions and fold them into the combined structure mask
  // — see textGrouping.ts's doc comment for why per-glyph rectangles alone
  // aren't enough to reliably protect (and later restore) a whole label.
  const textMarginAtWorkingRes = Math.max(1, Math.round(HUMANIZED_FLOORPLAN_TEXT_GROUP_MARGIN_PX / scaleToOriginal));
  const textGrouping = await groupTextRegions(detection.textMask, textMarginAtWorkingRes);
  cv.bitwise_or(detection.combinedMask, textGrouping.mask, detection.combinedMask);

  const textRegions = scaleRegionsToOriginal(textGrouping.regions, scaleToOriginal, width, height);
  const textProtectionMaskOriginalRes = new cv.Mat();
  if (width !== textGrouping.mask.cols || height !== textGrouping.mask.rows) {
    cv.resize(textGrouping.mask, textProtectionMaskOriginalRes, new cv.Size(width, height), 0, 0, cv.INTER_NEAREST);
  } else {
    textGrouping.mask.copyTo(textProtectionMaskOriginalRes);
  }
  textGrouping.mask.delete();

  // Safety margin is applied at WORKING resolution (scaled down accordingly)
  // so the visual margin ends up correct once resized back up.
  const marginAtWorkingRes = Math.max(1, Math.round(safetyMarginPx / scaleToOriginal));
  const dilateKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(marginAtWorkingRes * 2 + 1, marginAtWorkingRes * 2 + 1));
  const dilated = new cv.Mat();
  cv.dilate(detection.combinedMask, dilated, dilateKernel);

  // Resize back to the ORIGINAL image's exact dimensions — INTER_NEAREST
  // keeps the mask strictly binary (0/255), never introducing gray
  // anti-aliased edge pixels that would make "black vs white" ambiguous.
  const protectedMask = new cv.Mat();
  if (width !== dilated.cols || height !== dilated.rows) {
    cv.resize(dilated, protectedMask, new cv.Size(width, height), 0, 0, cv.INTER_NEAREST);
  } else {
    dilated.copyTo(protectedMask);
  }

  // Walls-only mask, also resized to original resolution — undilated
  // (the safety margin is a Fill-mask concern, not appropriate for a
  // pixel-exact line overlay, which should redraw the lines themselves,
  // not a fattened version of them).
  const wallsMaskOriginalRes = new cv.Mat();
  if (width !== detection.wallsMask.cols || height !== detection.wallsMask.rows) {
    cv.resize(detection.wallsMask, wallsMaskOriginalRes, new cv.Size(width, height), 0, 0, cv.INTER_NEAREST);
  } else {
    detection.wallsMask.copyTo(wallsMaskOriginalRes);
  }

  // BFL Fill convention: black (0) = preserved, white (255) = editable —
  // the exact inverse of our internal protected=255 convention.
  const fillMask = new cv.Mat();
  cv.bitwise_not(protectedMask, fillMask);
  const maskPng = await encodeMatToPng(fillMask);

  rgba.delete();
  gray.delete();
  enhanced.delete();
  detection.wallsMask.delete();
  detection.furnitureMask.delete();
  detection.textMask.delete();
  detection.archesMask.delete();
  detection.combinedMask.delete();
  dilateKernel.delete();
  dilated.delete();
  fillMask.delete();

  return { protectedMask, wallsMaskOriginalRes, textProtectionMaskOriginalRes, textRegions, maskPng, originalWidth: width, originalHeight: height };
}
