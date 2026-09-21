import { getOpenCv, OpenCv } from './opencvRuntime';
import { countBlobs, detectTextLikeMask } from './detectStructure';
import { PixelRect } from './usefulAreaCrop';

type Mat = InstanceType<OpenCv['Mat']>;

/**
 * Post-generation validation for Planta Humanizada's Fill pipeline —
 * implements requirement #8 as five distinct steps:
 *  1. Force the result back to the original image's EXACT dimensions.
 *  2. Re-draw the original wall lines pixel-for-pixel onto the result (a
 *     always-applied correction, independent of #3/#4/#5).
 *  3. Measure how much the FULL protected region (walls+furniture+text)
 *     drifted between input and output.
 *  4. Flag CANDIDATE new text-like marks the model may have invented in
 *     editable (non-protected) areas — FLUX models are known to hallucinate
 *     plausible-looking-but-meaningless labels/dimension figures even when
 *     asked not to; the prompt alone (humanizedFloorplanPromptBuilder.ts)
 *     is not treated as a sufficient guarantee. IMPORTANT: this is a cheap
 *     size/shape heuristic, proven to also flag furniture/rug/texture edges
 *     as false positives (see the "53 elementos" investigation) — it is
 *     ADVISORY ONLY and must never by itself cause a rejection. It only
 *     produces candidates + a warning; see decideFinalAcceptance below for
 *     what actually turns a flag into a rejection.
 *  5. The geometry deviation (#3) alone can still reject outright — that
 *     mechanism was never the unreliable one. The suspicious-text flag (#4)
 *     can only become a rejection once a second, OpenAI-based visual
 *     verification (providers/openaiTextVerification.ts, called from the
 *     route — this module stays network-free and independently testable)
 *     confirms genuinely new/corrupted text with sufficient confidence. A
 *     rejection must never trigger an automatic retry or a second charge —
 *     see routes/generateHumanizedFloorplan.ts, which only ever calls this
 *     once per user-initiated request.
 */

/** Fraction of average per-pixel intensity difference (0-1) tolerated inside protected regions before the whole result is rejected. Tunable — exposed as a parameter, not hardcoded into callers. */
export const DEFAULT_DEVIATION_TOLERANCE = 0.18;

/** 0-1 stray text-like blobs in the editable area are treated as detector noise; 2+ is treated as a candidate pattern worth sending to the second, OpenAI-based verification (never rejected on this alone — see decideFinalAcceptance). */
const SUSPICIOUS_TEXT_BLOB_THRESHOLD = 2;

export interface SuspiciousTextBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SuspiciousTextCheck {
  /** Advisory only: true means "candidates worth a second look", never "reject". */
  suspicious: boolean;
  newTextBlobCount: number;
  /** Bounding box of every candidate blob, in original-image pixels — passed as a hint to the second OpenAI verification call and used to render the private diagnostic image on rejection. */
  boxes: SuspiciousTextBox[];
  reason?: string;
}

/** One grouped/expanded original-text region (see textGrouping.ts) that was hard-restored to its exact original pixels after FLUX — requirement: "registre quais regiões foram restauradas." `pixelsChanged === 0` means FLUX was already faithful there and the restoration was a no-op. */
export interface TextRestorationRecord {
  region: PixelRect;
  pixelsChanged: number;
}

export interface ValidationResult {
  correctedRgba: Mat;
  deviation: number;
  /** True only when the geometry deviation check (#3) passes — deliberately NOT combined with the text heuristic here, see decideFinalAcceptance. */
  deviationAccepted: boolean;
  suspiciousText: SuspiciousTextCheck;
  /** Every original text/label region that was hard-restored (see restoreProtectedTextRegions) before the suspicious-text heuristic ran. */
  textRestorations: TextRestorationRecord[];
}

/** What the second, OpenAI-based verification call (providers/openaiTextVerification.ts) reports — the ONLY thing allowed to turn a suspicious-text candidate into a rejection. */
export interface TextVerificationOutcome {
  possuiTextoNovo: boolean;
  quantidade: number;
  boundingBoxes: { xMin: number; yMin: number; xMax: number; yMax: number }[];
  confianca: number;
  justificativa: string;
  /** Present when the caller is providers/openaiTextVerification.ts's real result (individually-discarded boxes + metrics — see textVerificationSchema.ts). Optional so a hand-built test fixture can omit them without extra boilerplate. */
  discardedBoxes?: unknown[];
  boxMetrics?: { totalReceived: number; totalAccepted: number; totalDiscarded: number };
}

export interface FinalAcceptanceInput {
  deviationAccepted: boolean;
  suspiciousText: SuspiciousTextCheck;
  /** Must be non-null whenever suspiciousText.suspicious is true — the route always calls the second verification in that case and never reaches this function on a technical failure of that call (it throws first, see runJob). The null branch here is a defense-in-depth fail-safe, not an expected production path. */
  textVerification: TextVerificationOutcome | null;
  minConfidence: number;
}

export type RejectionKind = 'geometry_deviation' | 'confirmed_new_text' | 'text_verification_missing' | 'text_correction_unsafe';

export interface FinalAcceptanceResult {
  accepted: boolean;
  rejectionKind?: RejectionKind;
}

/**
 * The single place that decides accept vs. reject for the WHOLE validation
 * gate. Pure and synchronous — no network, no OpenCV — so it's directly
 * unit-testable for every combination the requirements call out:
 *  - the heuristic flagging candidates never rejects by itself (only the
 *    confirmed branch below does);
 *  - a furniture/texture false positive (heuristic suspicious, verification
 *    says no real text) is accepted;
 *  - a confirmed hallucinated/corrupted text result is rejected;
 *  - geometry deviation rejects on its own, independent of text.
 */
export function decideFinalAcceptance(input: FinalAcceptanceInput): FinalAcceptanceResult {
  if (!input.deviationAccepted) {
    return { accepted: false, rejectionKind: 'geometry_deviation' };
  }
  if (input.suspiciousText.suspicious) {
    if (!input.textVerification) {
      return { accepted: false, rejectionKind: 'text_verification_missing' };
    }
    if (input.textVerification.possuiTextoNovo && input.textVerification.confianca >= input.minConfidence) {
      return { accepted: false, rejectionKind: 'confirmed_new_text' };
    }
  }
  return { accepted: true };
}

/** Step 1: resize/crop the generated image so its dimensions exactly match the original — BFL Fill can return a canvas that doesn't precisely match the request in edge cases (rounding, provider-side padding). */
export async function forceOriginalDimensions(generatedRgba: Mat, originalWidth: number, originalHeight: number): Promise<Mat> {
  const cv = await getOpenCv();
  if (generatedRgba.cols === originalWidth && generatedRgba.rows === originalHeight) {
    const copy = new cv.Mat();
    generatedRgba.copyTo(copy);
    return copy;
  }
  const resized = new cv.Mat();
  cv.resize(generatedRgba, resized, new cv.Size(originalWidth, originalHeight), 0, 0, cv.INTER_AREA);
  return resized;
}

/** Step 2: pixel-for-pixel re-draw of the original wall lines onto the generated result, regardless of how faithfully the model reproduced them. */
export async function overlayOriginalWallLines(originalRgba: Mat, generatedRgba: Mat, wallsMask: Mat): Promise<Mat> {
  const cv = await getOpenCv();
  const result = new cv.Mat();
  generatedRgba.copyTo(result);
  originalRgba.copyTo(result, wallsMask);
  return result;
}

/**
 * Step 2b: hard pixel-for-pixel restoration of every original text/label
 * region (see textGrouping.ts) — the SAME "copy the original back over
 * whatever FLUX drew there" operation overlayOriginalWallLines already does
 * for walls, applied region-by-region so each one's outcome can be recorded
 * individually (requirement: "restaure pixel a pixel todos os textos
 * originais protegidos... registre quais regiões foram restauradas").
 * Dimensions/alignment are exact by construction: every region is copied at
 * the identical (x,y,width,height) it was measured at on the SAME original
 * image, into the SAME position on `generatedRgba` (already forced to the
 * original's exact dimensions by the time this runs).
 */
export async function restoreProtectedTextRegions(originalRgba: Mat, generatedRgba: Mat, textRegions: PixelRect[]): Promise<{ corrected: Mat; restorations: TextRestorationRecord[] }> {
  const cv = await getOpenCv();
  const corrected = new cv.Mat();
  generatedRgba.copyTo(corrected);

  const restorations: TextRestorationRecord[] = [];
  for (const region of textRegions) {
    if (region.width <= 0 || region.height <= 0) continue;
    const rect = new cv.Rect(region.x, region.y, region.width, region.height);
    const originalRoi = originalRgba.roi(rect);
    const currentRoi = corrected.roi(rect);

    const diff = new cv.Mat();
    cv.absdiff(originalRoi, currentRoi, diff);
    const grayDiff = new cv.Mat();
    cv.cvtColor(diff, grayDiff, cv.COLOR_RGBA2GRAY);
    const pixelsChanged = cv.countNonZero(grayDiff);
    diff.delete();
    grayDiff.delete();

    originalRoi.copyTo(currentRoi);

    originalRoi.delete();
    currentRoi.delete();
    restorations.push({ region, pixelsChanged });
  }

  return { corrected, restorations };
}

/** Step 3: mean absolute pixel difference inside the protected region, normalized to 0 (identical) – 1 (maximally different). */
export async function computeProtectedRegionDeviation(originalRgba: Mat, generatedRgba: Mat, protectedMask: Mat): Promise<number> {
  const cv = await getOpenCv();
  const protectedPixelCount = cv.countNonZero(protectedMask);
  if (protectedPixelCount === 0) return 0;

  const diff = new cv.Mat();
  cv.absdiff(originalRgba, generatedRgba, diff);

  const grayDiff = new cv.Mat();
  cv.cvtColor(diff, grayDiff, cv.COLOR_RGBA2GRAY);

  // cv.mean(src, mask) already restricts the average to the masked pixels —
  // no need to zero out the rest and divide manually.
  const meanScalar = cv.mean(grayDiff, protectedMask) as unknown as number[];
  const deviation = meanScalar[0] / 255;

  diff.delete();
  grayDiff.delete();

  return deviation;
}

/**
 * Step 4: does the CORRECTED result contain text-like marks in areas that
 * were editable (i.e. NOT protected, so the original had nothing there)?
 * Reuses the exact same size/shape heuristic detectStructure.ts uses on the
 * original image — the only difference is that here anything landing
 * inside `protectedMask` is ignored (that's expected: original text the
 * model faithfully reproduced), and only blobs OUTSIDE it count, since by
 * definition the original image had no text there for the model to copy.
 */
export async function detectSuspiciousNewText(correctedRgba: Mat, protectedMask: Mat): Promise<SuspiciousTextCheck> {
  const cv = await getOpenCv();
  const gray = new cv.Mat();
  cv.cvtColor(correctedRgba, gray, cv.COLOR_RGBA2GRAY);

  // No exclude-mask here (unlike detectStructure.ts's own call) — we want
  // every text-like blob in the result first, then filter by protectedMask
  // ourselves below, since "already inside a wall" isn't the exclusion we
  // care about here.
  const textInResult = await detectTextLikeMask(gray, gray);

  const notProtected = new cv.Mat();
  cv.bitwise_not(protectedMask, notProtected);
  const newTextMask = new cv.Mat();
  cv.bitwise_and(textInResult, notProtected, newTextMask);

  const newTextBlobCount = await countBlobs(newTextMask);
  const boxes = extractBlobBoxes(cv, newTextMask);

  gray.delete();
  textInResult.delete();
  notProtected.delete();
  newTextMask.delete();

  const suspicious = newTextBlobCount >= SUSPICIOUS_TEXT_BLOB_THRESHOLD;
  return {
    suspicious,
    newTextBlobCount,
    boxes,
    reason: suspicious
      ? `Detectados ${newTextBlobCount} elementos semelhantes a texto em áreas editáveis que não existiam na planta original — candidatos para segunda verificação, ainda não confirmados.`
      : undefined,
  };
}

/** Per-connected-component bounding boxes of a binary mask, in the mask's own pixel space. Shared by detectSuspiciousNewText (candidate hints) and the route's private diagnostic image on rejection. */
function extractBlobBoxes(cv: OpenCv, mask: Mat): SuspiciousTextBox[] {
  const labels = new cv.Mat();
  const stats = new cv.Mat();
  const centroids = new cv.Mat();
  const numLabels = cv.connectedComponentsWithStats(mask, labels, stats, centroids, 8, cv.CV_32S);
  const boxes: SuspiciousTextBox[] = [];
  for (let label = 1; label < numLabels; label++) {
    boxes.push({
      x: stats.intAt(label, cv.CC_STAT_LEFT),
      y: stats.intAt(label, cv.CC_STAT_TOP),
      width: stats.intAt(label, cv.CC_STAT_WIDTH),
      height: stats.intAt(label, cv.CC_STAT_HEIGHT),
    });
  }
  labels.delete();
  stats.delete();
  centroids.delete();
  return boxes;
}

/**
 * Steps 1-4 combined — the single entry point routes/generateHumanizedFloorplan.ts
 * calls after a Fill response comes back. Deliberately does NOT decide
 * accept/reject on its own anymore (see decideFinalAcceptance) — the route
 * combines `deviationAccepted` here with the second OpenAI verification's
 * outcome (only run when `suspiciousText.suspicious` is true) to reach a
 * final verdict. Never call this twice for the same user request; a
 * rejection must surface as a non-billed error, not trigger a retry.
 */
export async function validateAndFinalizeResult(
  originalRgba: Mat,
  generatedRgba: Mat,
  protectedMask: Mat,
  wallsMask: Mat,
  textRegions: PixelRect[],
  originalWidth: number,
  originalHeight: number,
  tolerance: number = DEFAULT_DEVIATION_TOLERANCE
): Promise<ValidationResult> {
  const resized = await forceOriginalDimensions(generatedRgba, originalWidth, originalHeight);
  const deviation = await computeProtectedRegionDeviation(originalRgba, resized, protectedMask);
  const wallCorrected = await overlayOriginalWallLines(originalRgba, resized, wallsMask);
  resized.delete();

  const { corrected, restorations } = await restoreProtectedTextRegions(originalRgba, wallCorrected, textRegions);
  wallCorrected.delete();

  const suspiciousText = await detectSuspiciousNewText(corrected, protectedMask);

  return {
    correctedRgba: corrected,
    deviation,
    deviationAccepted: deviation <= tolerance,
    suspiciousText,
    textRestorations: restorations,
  };
}
