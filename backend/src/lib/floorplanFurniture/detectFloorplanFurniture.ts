import { getOpenCv, OpenCv } from '../floorplanMask/opencvRuntime';
import { decodeToMat } from '../floorplanMask/imageIO';
import { buildFloorplanMask } from '../floorplanMask/buildMask';
import { detectUsefulArea } from './usefulAreaDetection';
import { planCropRects } from './tiling';
import { extractCrop } from './cropExtraction';
import { denormalizeBox, denormalizePolygon } from './coordinateTransform';
import { dedupeDetections } from './deduplication';
import { combineDetectionsWithStructure } from './combineWithStructure';
import { detectFurnitureObjects, GeminiVisionDetectResult, GeminiVisionVariant, getGeminiCallCount } from '../../providers/geminiVision';
import { GEMINI_VISION_MODEL, GEMINI_VISION_THINKING_LEVEL } from '../../config/geminiVisionEngine';
import { CropCallOutcome, DenormalizedDetection, FurnitureDetectionReport, SourceCrop } from './types';

type Mat = InstanceType<OpenCv['Mat']>;

/**
 * Diagnostic-only context attached to a re-thrown error so a caller (the
 * inspection script) can report exactly which crop was being sent when a
 * Gemini call failed, and the exact non-secret request shape that was used
 * — never the image bytes/base64, never the API key.
 */
export interface GeminiCallFailureContext {
  cropId: string;
  variant: GeminiVisionVariant;
  model: string;
  promptContext: string;
  generationConfig: { thinking_level: string };
}

/** Sanitized (no key/base64/headers) one-line summary of a thrown error, for CropCallOutcome.errorMessage. */
function sanitizeErrorForOutcome(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/[A-Za-z0-9+/]{80,}={0,2}/g, '[BASE64_REDACTED]').slice(0, 500);
}

async function detectForCrop(
  cropId: string,
  variant: GeminiVisionVariant,
  imageBase64: string,
  promptContext: string
): Promise<GeminiVisionDetectResult> {
  const startedAt = Date.now();
  try {
    return await detectFurnitureObjects({ variant, imageBase64, mimeType: 'image/png', promptContext });
  } catch (err) {
    const context: GeminiCallFailureContext = {
      cropId,
      variant,
      model: GEMINI_VISION_MODEL,
      promptContext,
      generationConfig: { thinking_level: GEMINI_VISION_THINKING_LEVEL },
    };
    if (err && typeof err === 'object') {
      (err as Record<string, unknown>).geminiCallContext = context;
      (err as Record<string, unknown>).elapsedMs = Date.now() - startedAt;
    }
    throw err;
  }
}

const OVERVIEW_PROMPT_CONTEXT =
  'This image is the useful/drawn area of the full floor plan (surrounding blank margin already removed).';

function tilePromptContext(tileIndex: number, tileCount: number): string {
  return `This image is a zoomed-in section (tile ${tileIndex + 1} of ${tileCount}, with overlap on its neighbors) of a larger floor plan. Only report an object if more than half of it is visible inside THIS image — skip objects that are only barely visible at the very edge, since an overlapping neighboring tile already covers them fully.`;
}

export interface FurnitureDetectionArtifacts {
  originalRgba: Mat;
  usefulAreaRgba: Mat;
  overviewCropBuffer: Buffer;
  /** Only the tiles that were actually extracted — if the overview itself failed, this is empty (tiles are never attempted in that case). */
  tileCropBuffers: Buffer[];
  structuralProtectedMask: Mat;
  rawFurnitureMask: Mat;
  structureSubtractedMask: Mat;
}

export interface FurnitureDetectionRunResult {
  report: FurnitureDetectionReport;
  artifacts: FurnitureDetectionArtifacts;
}

export interface DetectFloorplanFurnitureOptions {
  /**
   * Invoked immediately after the overview call succeeds, before any tile
   * is attempted — lets the caller persist the overview's sanitized result
   * to disk right away (per requirement: "salve imediatamente seu JSON
   * sanitizado antes de iniciar os tiles"), so it survives even if a
   * later tile fails.
   */
  onOverviewSuccess?: (result: { rawOutputText: string; elapsedMs: number; detectionCount: number }) => void | Promise<void>;
}

/**
 * End-to-end orchestration, two phases:
 *  1. Overview — ONE call, boxes only (no segmentation), covering the whole
 *     useful area. If this fails, the whole function throws immediately —
 *     tiles are NEVER attempted without a successful overview (per explicit
 *     requirement), and the thrown error carries a GeminiCallFailureContext
 *     for the caller to report.
 *  2. Tiles — one call per tile, boxes + segmentation polygon, ONLY the
 *     geographic section of that tile. Each tile is attempted independently
 *     of the others: if tile-1 fails, tile-2 is still attempted, and
 *     whatever succeeded is kept (per requirement: "preserve os resultados
 *     anteriores que tiverem funcionado"). No tile is ever retried
 *     automatically.
 *
 * Detections from both phases are merged (dedupeDetections prefers a tile's
 * polygon over the overview's box-only version for the same object — see
 * deduplication.ts) and combined with the EXISTING OpenCV structural mask
 * (reused verbatim from buildFloorplanMask.ts) to decide
 * replaceable/uncertain/rejected.
 *
 * Every Gemini call goes through providers/geminiVision.ts, which is the
 * only place that ever makes a network request here — this function never
 * touches FLUX.1 Fill, the credit wallet, or any paid endpoint.
 */
export async function detectFloorplanFurniture(imageBuffer: Buffer, options: DetectFloorplanFurnitureOptions = {}): Promise<FurnitureDetectionRunResult> {
  const startedAt = Date.now();
  const cv = await getOpenCv();
  const callCountBefore = getGeminiCallCount();

  const { mat: rgba, width: originalWidth, height: originalHeight } = await decodeToMat(imageBuffer);

  const usefulArea = await detectUsefulArea(rgba);
  const usefulAreaRoi = rgba.roi(new cv.Rect(usefulArea.x, usefulArea.y, usefulArea.width, usefulArea.height));
  const usefulAreaRgba = new cv.Mat();
  usefulAreaRoi.copyTo(usefulAreaRgba);
  usefulAreaRoi.delete();

  const { overview, tiles } = planCropRects(usefulArea);

  const crops: SourceCrop[] = [];
  const callOutcomes: CropCallOutcome[] = [];
  const allDetections: DenormalizedDetection[] = [];

  // --- Phase 1: overview (boxes only). A failure here stops everything —
  // tiles are only ever attempted after a successful overview. ---
  const overviewExtracted = await extractCrop(rgba, overview, 'overview');
  crops.push(overviewExtracted.crop);

  let overviewResult: GeminiVisionDetectResult;
  try {
    overviewResult = await detectForCrop(overviewExtracted.crop.id, 'overview', overviewExtracted.pngBuffer.toString('base64'), OVERVIEW_PROMPT_CONTEXT);
  } catch (err) {
    const elapsedMs = err && typeof err === 'object' && typeof (err as Record<string, unknown>).elapsedMs === 'number' ? ((err as Record<string, unknown>).elapsedMs as number) : Date.now() - startedAt;
    callOutcomes.push({ cropId: 'overview', variant: 'overview', success: false, elapsedMs, errorMessage: sanitizeErrorForOutcome(err) });
    if (err && typeof err === 'object') {
      (err as Record<string, unknown>).partialCallOutcomes = callOutcomes;
    }
    throw err;
  }

  callOutcomes.push({ cropId: 'overview', variant: 'overview', success: true, elapsedMs: overviewResult.elapsedMs, detectionCount: overviewResult.detections.length });

  if (options.onOverviewSuccess) {
    await options.onOverviewSuccess({
      rawOutputText: overviewResult.rawOutputText,
      elapsedMs: overviewResult.elapsedMs,
      detectionCount: overviewResult.detections.length,
    });
  }

  for (const raw of overviewResult.detections) {
    allDetections.push({
      category: raw.category,
      label: raw.label,
      roomType: raw.roomType,
      confidence: raw.confidence,
      boxOriginalPixels: denormalizeBox(raw.box_2d, overviewExtracted.crop, originalWidth, originalHeight),
      polygonOriginalPixels: null,
      sourceCropIds: [overviewExtracted.crop.id],
    });
  }

  // --- Phase 2: tiles (boxes + segmentation). Each tile is independent —
  // one failing does not stop the others, and no tile is ever retried. ---
  const tileCropBuffers: Buffer[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const tileId = `tile-${i + 1}`;
    const extracted = await extractCrop(rgba, tiles[i], tileId);
    tileCropBuffers.push(extracted.pngBuffer);
    crops.push(extracted.crop);

    try {
      const result = await detectForCrop(tileId, 'tile', extracted.pngBuffer.toString('base64'), tilePromptContext(i, tiles.length));
      callOutcomes.push({ cropId: tileId, variant: 'tile', success: true, elapsedMs: result.elapsedMs, detectionCount: result.detections.length });
      for (const raw of result.detections) {
        allDetections.push({
          category: raw.category,
          label: raw.label,
          roomType: raw.roomType,
          confidence: raw.confidence,
          boxOriginalPixels: denormalizeBox(raw.box_2d, extracted.crop, originalWidth, originalHeight),
          polygonOriginalPixels: raw.mask ? denormalizePolygon(raw.mask, extracted.crop, originalWidth, originalHeight) : null,
          sourceCropIds: [extracted.crop.id],
        });
      }
    } catch (err) {
      const elapsedMs = err && typeof err === 'object' && typeof (err as Record<string, unknown>).elapsedMs === 'number' ? ((err as Record<string, unknown>).elapsedMs as number) : 0;
      callOutcomes.push({ cropId: tileId, variant: 'tile', success: false, elapsedMs, errorMessage: sanitizeErrorForOutcome(err) });
      // Deliberately swallowed here (not re-thrown): a failing tile must
      // not stop the next tile or discard what already succeeded.
    }
  }

  const deduped = dedupeDetections(allDetections);

  const maskResult = await buildFloorplanMask(imageBuffer);

  const combined = await combineDetectionsWithStructure(deduped, maskResult.protectedMask, originalWidth, originalHeight);

  maskResult.wallsMaskOriginalRes.delete();
  maskResult.textProtectionMaskOriginalRes.delete();

  const totalTimeMs = Date.now() - startedAt;
  const geminiCallCount = getGeminiCallCount() - callCountBefore;

  return {
    report: {
      detections: combined.detections,
      originalWidth,
      originalHeight,
      usefulArea,
      crops,
      callOutcomes,
      geminiCallCount,
      model: GEMINI_VISION_MODEL,
      thinkingLevel: GEMINI_VISION_THINKING_LEVEL,
      totalTimeMs,
    },
    artifacts: {
      originalRgba: rgba,
      usefulAreaRgba,
      overviewCropBuffer: overviewExtracted.pngBuffer,
      tileCropBuffers,
      structuralProtectedMask: maskResult.protectedMask,
      rawFurnitureMask: combined.rawFurnitureMask,
      structureSubtractedMask: combined.structureSubtractedMask,
    },
  };
}
