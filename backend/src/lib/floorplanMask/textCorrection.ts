import { getOpenCv, OpenCv } from './opencvRuntime';
import { detectSuspiciousNewText, SuspiciousTextBox, SuspiciousTextCheck } from './floorplanValidation';
import { PixelRect } from './usefulAreaCrop';

type Mat = InstanceType<OpenCv['Mat']>;

/**
 * Local, surgical, offline-only correction for a CONFIRMED new-text box
 * (from providers/openaiTextVerification.ts) — applied AFTER FLUX, AFTER
 * the wall/text hard-restoration in floorplanValidation.ts, and only ever
 * to boxes OpenAI itself confirmed (never a raw, unconfirmed heuristic
 * candidate — requirement: "não apague áreas sem confirmação").
 *
 * The idea: a hallucinated label/watermark drawn over a previously blank
 * (uniform) background can be safely undone by pasting the original pixels
 * back with a soft-feathered edge — same principle as restoreProtectedTextRegions,
 * but for a region that was NOT already known to be text before generation.
 * A confirmed new-text box sitting over floor texture, furniture, vegetation,
 * or any other detailed content is NOT touched — undoing it would either be
 * impossible (we don't know what was "supposed" to be there) or would leave
 * a visible patch, so that case rejects instead (requirement: "se estiver
 * sobre piso, textura, móvel, vegetação ou região relevante, rejeite").
 *
 * No FLUX call, no OpenAI call, no network of any kind — pure OpenCV pixel
 * operations plus one offline re-run of detectSuspiciousNewText.
 */

export interface RegionUniformityCheck {
  uniform: boolean;
  stdDev: number;
  meanBrightness: number;
}

/** Grayscale standard deviation of `rect` in `rgba` — low stdDev means a flat/blank background (safe to patch); high stdDev means real detail (floor pattern, furniture, vegetation) is present. */
export async function checkRegionUniformity(rgba: Mat, rect: PixelRect, stdDevThreshold: number): Promise<RegionUniformityCheck> {
  const cv = await getOpenCv();
  const clamped = clampRect(rect, rgba.cols, rgba.rows);
  if (clamped.width <= 0 || clamped.height <= 0) {
    return { uniform: false, stdDev: Infinity, meanBrightness: 0 };
  }
  const roi = rgba.roi(new cv.Rect(clamped.x, clamped.y, clamped.width, clamped.height));
  const gray = new cv.Mat();
  cv.cvtColor(roi, gray, cv.COLOR_RGBA2GRAY);
  roi.delete();

  const mean = new cv.Mat();
  const stdDev = new cv.Mat();
  cv.meanStdDev(gray, mean, stdDev);
  const meanBrightness = mean.data64F[0];
  const stdDevValue = stdDev.data64F[0];
  gray.delete();
  mean.delete();
  stdDev.delete();

  return { uniform: stdDevValue <= stdDevThreshold, stdDev: stdDevValue, meanBrightness };
}

/** True when two axis-aligned rects share any area. Used to tell a residual heuristic candidate that falls INSIDE a just-corrected region (blocking — the correction didn't fully clean it) apart from one that falls entirely OUTSIDE every corrected region (a pre-existing candidate OpenAI already implicitly did not confirm — never blocking, see requirement #2/#4 of the 2026-09-19 fix). */
function rectsOverlap(a: PixelRect, b: PixelRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function clampRect(rect: PixelRect, width: number, height: number): PixelRect {
  const x0 = Math.max(0, Math.min(width, rect.x));
  const y0 = Math.max(0, Math.min(height, rect.y));
  const x1 = Math.max(0, Math.min(width, rect.x + rect.width));
  const y1 = Math.max(0, Math.min(height, rect.y + rect.height));
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

function expandRect(rect: PixelRect, marginPx: number, width: number, height: number): PixelRect {
  return clampRect({ x: rect.x - marginPx, y: rect.y - marginPx, width: rect.width + marginPx * 2, height: rect.height + marginPx * 2 }, width, height);
}

/**
 * Hard safety net (requirement: "alteração fora das caixas deve rejeitar"):
 * verifies that NOTHING changed between `before` and `after` outside every
 * zone this pass actually touched. `touchedZones` should already include
 * the Gaussian blur kernel's finite support (see pasteWithFeather — a
 * kernel of size featherPx*2+1 can influence pixels up to ~featherPx beyond
 * `rect`'s own edge, by construction, never further), so a genuine positive
 * here means an actual implementation bug, not expected feather bleed.
 */
export async function detectExternalModification(before: Mat, after: Mat, touchedZones: PixelRect[]): Promise<boolean> {
  const cv = await getOpenCv();
  const width = before.cols;
  const height = before.rows;

  const outsideMask = new cv.Mat(height, width, cv.CV_8UC1, new cv.Scalar(255));
  for (const zone of touchedZones) {
    if (zone.width <= 0 || zone.height <= 0) continue;
    cv.rectangle(outsideMask, new cv.Point(zone.x, zone.y), new cv.Point(zone.x + zone.width, zone.y + zone.height), new cv.Scalar(0), -1);
  }

  const diff = new cv.Mat();
  cv.absdiff(before, after, diff);
  const grayDiff = new cv.Mat();
  cv.cvtColor(diff, grayDiff, cv.COLOR_RGBA2GRAY);
  diff.delete();

  const maskedDiff = new cv.Mat();
  cv.bitwise_and(grayDiff, grayDiff, maskedDiff, outsideMask);
  grayDiff.delete();
  outsideMask.delete();

  const changed = cv.countNonZero(maskedDiff) > 0;
  maskedDiff.delete();
  return changed;
}

/**
 * Pastes `source`'s pixels over `dest` within `rect`, with a Gaussian-
 * feathered edge (requirement: "transição segura") instead of a hard-edged
 * copy — built from plain OpenCV ops (blur + float blend), not a
 * WASM-build-specific API like seamlessClone, so it works the same on every
 * @techstark/opencv-js build this project targets. Only pixels within
 * `rect` expanded by `featherPx` are ever touched; everything further away
 * is provably untouched (the blend weight there is exactly 0).
 */
async function pasteWithFeather(cv: OpenCv, dest: Mat, source: Mat, rect: PixelRect, featherPx: number): Promise<void> {
  const width = dest.cols;
  const height = dest.rows;

  const maskFull = cv.Mat.zeros(height, width, cv.CV_8UC1);
  cv.rectangle(maskFull, new cv.Point(rect.x, rect.y), new cv.Point(rect.x + rect.width, rect.y + rect.height), new cv.Scalar(255), -1);
  const kernelSize = Math.max(1, featherPx) * 2 + 1;
  const feathered = new cv.Mat();
  cv.GaussianBlur(maskFull, feathered, new cv.Size(kernelSize, kernelSize), 0);
  maskFull.delete();

  const alpha4 = new cv.Mat();
  cv.cvtColor(feathered, alpha4, cv.COLOR_GRAY2RGBA);
  feathered.delete();
  const alphaFloat = new cv.Mat();
  alpha4.convertTo(alphaFloat, cv.CV_32FC4, 1 / 255);
  alpha4.delete();

  const ones = new cv.Mat(height, width, cv.CV_32FC4, new cv.Scalar(1, 1, 1, 1));
  const oneMinusAlpha = new cv.Mat();
  cv.subtract(ones, alphaFloat, oneMinusAlpha);
  ones.delete();

  const destFloat = new cv.Mat();
  dest.convertTo(destFloat, cv.CV_32FC4);
  const sourceFloat = new cv.Mat();
  source.convertTo(sourceFloat, cv.CV_32FC4);

  const weightedSource = new cv.Mat();
  cv.multiply(sourceFloat, alphaFloat, weightedSource);
  const weightedDest = new cv.Mat();
  cv.multiply(destFloat, oneMinusAlpha, weightedDest);
  const blendedFloat = new cv.Mat();
  cv.add(weightedSource, weightedDest, blendedFloat);

  const blendedU8 = new cv.Mat();
  blendedFloat.convertTo(blendedU8, cv.CV_8UC4);
  blendedU8.copyTo(dest);

  alphaFloat.delete();
  oneMinusAlpha.delete();
  destFloat.delete();
  sourceFloat.delete();
  weightedSource.delete();
  weightedDest.delete();
  blendedFloat.delete();
  blendedU8.delete();
}

export type TextBoxCorrectionVerdict =
  | 'restored'
  | 'rejected_relevant_region'
  | 'rejected_visible_smudge'
  | 'rejected_residual_overlap'
  | 'skipped_degenerate';

export interface TextBoxCorrectionDecision {
  box: { xMin: number; yMin: number; xMax: number; yMax: number };
  verdict: TextBoxCorrectionVerdict;
  stdDevBefore: number;
  stdDevAfter: number | null;
  marginPx: number;
}

export interface TextCorrectionOutcome {
  correctedRgba: Mat;
  decisions: TextBoxCorrectionDecision[];
  /**
   * True only if EVERY confirmed box ended up 'restored' — requirement:
   * "não aceite automaticamente apenas porque houve restauração" is
   * enforced by the CALLER still requiring this before continuing
   * validation. Deliberately does NOT depend on the GLOBAL
   * `residualSuspiciousText.suspicious` flag (2026-09-19 fix): a heuristic
   * candidate that sits entirely OUTSIDE every corrected region is a
   * pre-existing candidate the OpenAI verification already implicitly
   * dismissed (it wasn't in `confirmedBoxes`) — since nothing outside a
   * confirmed+corrected region was ever touched, that candidate is
   * identical to what it was when the second verification call already
   * ran, and re-flagging it now would reject a result for a reason already
   * adjudicated. Only a residual candidate OVERLAPPING a corrected region
   * (see `residualBoxesWithinConfirmedRegions`) blocks that box.
   */
  allSafelyCorrected: boolean;
  /** The offline heuristic re-run on the corrected image, UNFILTERED — kept for diagnostics/transparency only (e.g. "18 candidates total"). Never used directly as a blocking gate — see `allSafelyCorrected` and the two partitioned lists below. */
  residualSuspiciousText: SuspiciousTextCheck;
  /** Residual candidates that overlap a region this function actually corrected — these DO block (requirement: "resíduos detectados nas regiões corrigidas"). */
  residualBoxesWithinConfirmedRegions: SuspiciousTextBox[];
  /** Residual candidates entirely outside every corrected region — pre-existing, already-adjudicated-by-omission candidates. Purely informational; never block (requirement: "candidatos externos já avaliados não devem causar uma nova rejeição"). */
  residualBoxesExternal: SuspiciousTextBox[];
  /** Hard safety-invariant result (requirement: "alteração fora das caixas deve rejeitar") — true only if a bug caused a pixel to change outside every zone this pass actually touched. Should never be true given the current implementation; alone forces `allSafelyCorrected` to false if it ever is. */
  externalModificationDetected: boolean;
}

/**
 * Attempts to locally undo every CONFIRMED new-text box, one at a time,
 * never touching a box that isn't in `confirmedBoxes`. Returns a corrected
 * image plus a per-box decision — the caller (routes/generateHumanizedFloorplan.ts)
 * decides what to do with the result; this function never decides
 * accept/reject on its own.
 */
export async function attemptTextCorrectionAndRevalidate(
  originalRgba: Mat,
  correctedRgba: Mat,
  protectedMask: Mat,
  confirmedBoxes: { xMin: number; yMin: number; xMax: number; yMax: number }[],
  marginPx: number,
  stdDevThreshold: number
): Promise<TextCorrectionOutcome> {
  const cv = await getOpenCv();
  const width = originalRgba.cols;
  const height = originalRgba.rows;

  const working = new cv.Mat();
  correctedRgba.copyTo(working);

  // Tracked alongside `decisions` (not exposed) so the residual-overlap pass
  // below can map a still-tentative 'restored' verdict back to the exact
  // region it corrected — a box that fails earlier (relevant region, smudge,
  // degenerate) never gets a rect here and is excluded from that check.
  const pendingRestored: { index: number; rect: PixelRect }[] = [];
  const decisions: TextBoxCorrectionDecision[] = [];
  // Every zone pasteWithFeather actually touched (rect expanded by that
  // box's own feather radius, i.e. the Gaussian kernel's finite support) —
  // used by the "alteração fora das caixas" safety check below. Includes
  // zones for boxes later downgraded to 'rejected_visible_smudge' or
  // 'rejected_residual_overlap' too, since pasteWithFeather already ran for
  // those before the downgrade.
  const touchedZones: PixelRect[] = [];

  for (const box of confirmedBoxes) {
    const x0 = Math.max(0, Math.floor(box.xMin) - marginPx);
    const y0 = Math.max(0, Math.floor(box.yMin) - marginPx);
    const x1 = Math.min(width, Math.ceil(box.xMax) + marginPx);
    const y1 = Math.min(height, Math.ceil(box.yMax) + marginPx);
    if (x1 <= x0 || y1 <= y0) {
      decisions.push({ box, verdict: 'skipped_degenerate', stdDevBefore: 0, stdDevAfter: null, marginPx });
      continue;
    }
    const rect: PixelRect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };

    const before = await checkRegionUniformity(originalRgba, rect, stdDevThreshold);
    if (!before.uniform) {
      decisions.push({ box, verdict: 'rejected_relevant_region', stdDevBefore: before.stdDev, stdDevAfter: null, marginPx });
      continue;
    }

    const featherPx = Math.max(2, Math.round(marginPx / 2));
    await pasteWithFeather(cv, working, originalRgba, rect, featherPx);
    touchedZones.push(expandRect(rect, featherPx, width, height));

    const after = await checkRegionUniformity(working, rect, stdDevThreshold);
    if (!after.uniform) {
      decisions.push({ box, verdict: 'rejected_visible_smudge', stdDevBefore: before.stdDev, stdDevAfter: after.stdDev, marginPx });
      continue;
    }

    pendingRestored.push({ index: decisions.length, rect });
    decisions.push({ box, verdict: 'restored', stdDevBefore: before.stdDev, stdDevAfter: after.stdDev, marginPx });
  }

  const externalModificationDetected = await detectExternalModification(correctedRgba, working, touchedZones);

  // ONE global heuristic re-run (requirement: "execute novamente o detector
  // offline após a restauração") — its candidates are then partitioned
  // geometrically, never trusted wholesale as a blocking signal.
  const residualSuspiciousText = await detectSuspiciousNewText(working, protectedMask);

  const correctedRects = pendingRestored.map((p) => p.rect);
  const residualBoxesWithinConfirmedRegions: SuspiciousTextBox[] = [];
  const residualBoxesExternal: SuspiciousTextBox[] = [];
  for (const candidate of residualSuspiciousText.boxes) {
    if (correctedRects.some((rect) => rectsOverlap(candidate, rect))) {
      residualBoxesWithinConfirmedRegions.push(candidate);
    } else {
      residualBoxesExternal.push(candidate);
    }
  }

  // Downgrade any tentatively-'restored' box whose OWN region still overlaps a residual candidate — a candidate elsewhere never affects a box it doesn't touch.
  for (const pending of pendingRestored) {
    const stillSuspicious = residualBoxesWithinConfirmedRegions.some((candidate) => rectsOverlap(candidate, pending.rect));
    if (stillSuspicious) {
      decisions[pending.index] = { ...decisions[pending.index], verdict: 'rejected_residual_overlap' };
    }
  }

  const allSafelyCorrected = !externalModificationDetected && (decisions.length > 0 ? decisions.every((d) => d.verdict === 'restored') : true);

  return {
    correctedRgba: working,
    decisions,
    allSafelyCorrected,
    residualSuspiciousText,
    residualBoxesWithinConfirmedRegions,
    residualBoxesExternal,
    externalModificationDetected,
  };
}
