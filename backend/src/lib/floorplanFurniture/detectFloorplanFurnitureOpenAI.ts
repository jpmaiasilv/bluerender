import crypto from 'node:crypto';
import { getOpenCv, OpenCv } from '../floorplanMask/opencvRuntime';
import { decodeToMat } from '../floorplanMask/imageIO';
import { buildFloorplanMask } from '../floorplanMask/buildMask';
import { detectUsefulArea } from './usefulAreaDetection';
import { planCropRects } from './tiling';
import { extractCrop } from './cropExtraction';
import { mapBoxToOriginal, mapPolygonToOriginal } from './openaiCoordinateTransform';
import { dedupeOpenAIObjects, dedupeOpenAIRooms } from './deduplicationOpenAI';
import { combineOpenAIWithStructure } from './combineWithStructureOpenAI';
import { detectFurnitureObjectsOpenAI, getOpenAiVisionCallCount, OpenAIVisionDetectResult, OpenAIVisionVariant } from '../../providers/openaiVision';
import { OPENAI_VISION_MODEL } from '../../config/openaiModels';
import { ObjectFilterMetrics } from './openaiResponseSchema';
import { saveVisionDetectionDiagnostics, startVisionDetectionDiagnosticsCleanup } from '../../storage/visionDetectionDiagnosticsStore';
import { AppError } from '../errors';
import { DenormalizedOpenAIObject, DenormalizedOpenAIRoom, FinalOpenAIObject, FinalOpenAIRoom } from './openaiTypes';
import { CropCallOutcome, PixelRect, SourceCrop } from './types';

type Mat = InstanceType<OpenCv['Mat']>;

export interface OpenAICallFailureContext {
  cropId: string;
  variant: OpenAIVisionVariant;
  model: string;
}

/** Prefers an AppError's `details` (already sanitized at the throw site — see providers/openaiVision.ts) for a richer internal-only outcome log; falls back to `.message` for any other error shape. Never includes image data, the prompt, or a secret either way. */
function sanitizeErrorForOutcome(err: unknown): string {
  const message = err instanceof AppError ? `${err.message} ${err.details ?? ''}`.trim() : err instanceof Error ? err.message : String(err);
  return message.replace(/[A-Za-z0-9+/]{80,}={0,2}/g, '[BASE64_REDACTED]').slice(0, 500);
}

async function detectForCrop(
  cropId: string,
  variant: OpenAIVisionVariant,
  imageBase64: string,
  cropWidth: number,
  cropHeight: number,
  promptContext: string
): Promise<OpenAIVisionDetectResult> {
  const startedAt = Date.now();
  try {
    return await detectFurnitureObjectsOpenAI({ variant, imageBase64, mimeType: 'image/png', cropWidth, cropHeight, promptContext });
  } catch (err) {
    const context: OpenAICallFailureContext = { cropId, variant, model: OPENAI_VISION_MODEL };
    if (err && typeof err === 'object') {
      (err as Record<string, unknown>).openaiCallContext = context;
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

export interface FurnitureDetectionArtifactsOpenAI {
  originalRgba: Mat;
  usefulAreaRgba: Mat;
  overviewCropBuffer: Buffer;
  tileCropBuffers: Buffer[];
  structuralProtectedMask: Mat;
  rawFurnitureMask: Mat;
  structureSubtractedMask: Mat;
}

/** Per-phase semantic-filter metrics, kept SEPARATE between overview and tiles (requirement #5: "tudo separado entre overview e tiles") — never merged into one aggregate that would hide which phase discarded what. `tileObjects`/`tileRooms` has one entry per tile actually called (a failing tile still gets no metrics entry, same as it gets no callOutcome detectionCount). */
export interface VisionFilterMetricsSummary {
  overviewObjects: ObjectFilterMetrics;
  overviewRooms: ObjectFilterMetrics;
  tileObjects: ObjectFilterMetrics[];
  tileRooms: ObjectFilterMetrics[];
}

export interface FurnitureDetectionReportOpenAI {
  objects: FinalOpenAIObject[];
  rooms: FinalOpenAIRoom[];
  originalWidth: number;
  originalHeight: number;
  usefulArea: PixelRect;
  crops: SourceCrop[];
  callOutcomes: CropCallOutcome[];
  requestIds: (string | null)[];
  usageTotals: { inputTokens: number; outputTokens: number; totalTokens: number };
  /** Every `warnings` entry the model itself returned, across all crops actually sent — surfaced verbatim (already just descriptive text, never containing secrets) for the caller to report on ambiguity the model flagged itself. */
  modelWarnings: string[];
  model: string;
  callCount: number;
  totalTimeMs: number;
  /** Individual-detection acceptance/discard metrics — see VisionFilterMetricsSummary. */
  visionMetrics: VisionFilterMetricsSummary;
  /** True only when the tile phase actually ran (it's skipped both by `overviewOnly` and by the "nothing usable in the overview" gate — see requirement #4). */
  tilesRan: boolean;
}

export interface FurnitureDetectionRunResultOpenAI {
  report: FurnitureDetectionReportOpenAI;
  artifacts: FurnitureDetectionArtifactsOpenAI;
}

export interface DetectFloorplanFurnitureOpenAIOptions {
  /** Invoked immediately after the overview call succeeds, before any tile is attempted — see detectFloorplanFurniture.ts's identical contract for the Gemini pipeline. */
  onOverviewSuccess?: (result: { rawOutputText: string; elapsedMs: number; roomCount: number; objectCount: number; requestId: string | null }) => void | Promise<void>;
  /** When true, the tile phase is skipped entirely — no tile crop is even extracted, let alone sent. Used for a deliberately overview-only inspection run; the returned report/artifacts are still fully valid, just built only from the overview's box-only detections (no segmentation polygons). */
  overviewOnly?: boolean;
  /**
   * Groups this run's private vision-detection diagnostics (accepted/discarded
   * detections + reasons, per crop — see storage/visionDetectionDiagnosticsStore.ts)
   * under one folder. Callers with a real jobId (routes/generateHumanizedFloorplan.ts)
   * should pass it so diagnostics are associated with that job; standalone
   * scripts (inspect-openai-furniture.ts) get a fresh generated id when omitted.
   */
  diagnosticsId?: string;
}

/**
 * OpenAI equivalent of detectFloorplanFurniture.ts (Gemini) — same
 * two-phase contract (overview must succeed before any tile is attempted;
 * a failing tile does not abort the others or discard what already
 * succeeded), same reuse of the provider-agnostic useful-area/tiling/crop
 * pieces, same "never let the AI provider erase OpenCV's structural
 * protection" guarantee (see combineOpenAIWithStructure). Deliberately a
 * SEPARATE function (not a shared one branching on provider) so the Gemini
 * path can keep working completely untouched while this one evolves.
 */
export async function detectFloorplanFurnitureOpenAI(
  imageBuffer: Buffer,
  options: DetectFloorplanFurnitureOpenAIOptions = {}
): Promise<FurnitureDetectionRunResultOpenAI> {
  startVisionDetectionDiagnosticsCleanup();
  const diagnosticsId = options.diagnosticsId ?? crypto.randomUUID();

  const startedAt = Date.now();
  const cv = await getOpenCv();
  const callCountBefore = getOpenAiVisionCallCount();

  const { mat: rgba, width: originalWidth, height: originalHeight } = await decodeToMat(imageBuffer);

  const usefulArea = await detectUsefulArea(rgba);
  const usefulAreaRoi = rgba.roi(new cv.Rect(usefulArea.x, usefulArea.y, usefulArea.width, usefulArea.height));
  const usefulAreaRgba = new cv.Mat();
  usefulAreaRoi.copyTo(usefulAreaRgba);
  usefulAreaRoi.delete();

  const { overview, tiles } = planCropRects(usefulArea);

  const crops: SourceCrop[] = [];
  const callOutcomes: CropCallOutcome[] = [];
  const requestIds: (string | null)[] = [];
  const usageTotals = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const allObjects: DenormalizedOpenAIObject[] = [];
  const allRooms: DenormalizedOpenAIRoom[] = [];
  const modelWarnings: string[] = [];
  const tileObjectMetrics: ObjectFilterMetrics[] = [];
  const tileRoomMetrics: ObjectFilterMetrics[] = [];

  function addUsage(usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null) {
    if (!usage) return;
    usageTotals.inputTokens += usage.inputTokens;
    usageTotals.outputTokens += usage.outputTokens;
    usageTotals.totalTokens += usage.totalTokens;
  }

  // --- Phase 1: overview (boxes only). A structural failure here stops everything (throws — see providers/openaiVision.ts, surfaces as VALIDATION_ERROR). An implausible individual detection does NOT stop anything — it's filtered out on its own before this function ever sees it. ---
  const overviewExtracted = await extractCrop(rgba, overview, 'overview');
  crops.push(overviewExtracted.crop);

  let overviewResult: OpenAIVisionDetectResult;
  try {
    overviewResult = await detectForCrop(
      overviewExtracted.crop.id,
      'overview',
      overviewExtracted.pngBuffer.toString('base64'),
      overviewExtracted.crop.sentWidth,
      overviewExtracted.crop.sentHeight,
      OVERVIEW_PROMPT_CONTEXT
    );
  } catch (err) {
    const elapsedMs = err && typeof err === 'object' && typeof (err as Record<string, unknown>).elapsedMs === 'number' ? ((err as Record<string, unknown>).elapsedMs as number) : Date.now() - startedAt;
    callOutcomes.push({ cropId: 'overview', variant: 'overview', success: false, elapsedMs, errorMessage: sanitizeErrorForOutcome(err) });
    if (err && typeof err === 'object') {
      (err as Record<string, unknown>).partialCallOutcomes = callOutcomes;
    }
    throw err;
  }

  callOutcomes.push({ cropId: 'overview', variant: 'overview', success: true, elapsedMs: overviewResult.elapsedMs, detectionCount: overviewResult.result.objects.length + overviewResult.result.rooms.length });
  requestIds.push(overviewResult.requestId);
  addUsage(overviewResult.usage);
  modelWarnings.push(...overviewResult.result.warnings.map((w) => `[overview] ${w}`));

  saveVisionDetectionDiagnostics(diagnosticsId, 'overview', {
    variant: 'overview',
    cropWidth: overviewExtracted.crop.sentWidth,
    cropHeight: overviewExtracted.crop.sentHeight,
    acceptedObjects: overviewResult.result.objects,
    discardedObjects: overviewResult.result.discardedObjects,
    objectMetrics: overviewResult.result.objectMetrics,
    acceptedRooms: overviewResult.result.rooms,
    discardedRooms: overviewResult.result.discardedRooms,
    roomMetrics: overviewResult.result.roomMetrics,
    requestId: overviewResult.requestId,
    elapsedMs: overviewResult.elapsedMs,
  });

  if (options.onOverviewSuccess) {
    await options.onOverviewSuccess({
      rawOutputText: overviewResult.rawOutputText,
      elapsedMs: overviewResult.elapsedMs,
      roomCount: overviewResult.result.rooms.length,
      objectCount: overviewResult.result.objects.length,
      requestId: overviewResult.requestId,
    });
  }

  for (const room of overviewResult.result.rooms) {
    allRooms.push({
      id: room.id,
      type: room.type,
      label: room.label,
      confidence: room.confidence,
      boxOriginalPixels: mapBoxToOriginal(room.box, overviewExtracted.crop, originalWidth, originalHeight),
      sourceCropIds: [overviewExtracted.crop.id],
    });
  }
  for (const obj of overviewResult.result.objects) {
    allObjects.push({
      id: obj.id,
      category: obj.category,
      subcategory: obj.subcategory,
      roomType: obj.roomType,
      confidence: obj.confidence,
      orientationDegrees: obj.orientationDegrees,
      boxOriginalPixels: mapBoxToOriginal(obj.box, overviewExtracted.crop, originalWidth, originalHeight),
      polygonOriginalPixels: null,
      replaceable: obj.replaceable,
      notes: obj.notes,
      sourceCropIds: [overviewExtracted.crop.id],
    });
  }

  // --- Phase 2: tiles (boxes + segmentation). Independent — one failing tile never stops the others. Skipped when overviewOnly is set, OR (requirement #4) when the overview left nothing usable at all — no accepted object AND no accepted room — since there is then no anchor worth refining. Having at least one accepted ROOM (even with zero objects) is enough to proceed, specifically so small objects can still be recovered by a closer tile pass. ---
  const overviewHasUsableData = overviewResult.result.objects.length > 0 || overviewResult.result.rooms.length > 0;
  const shouldRunTiles = !options.overviewOnly && overviewHasUsableData;

  const tileCropBuffers: Buffer[] = [];
  const effectiveTiles = shouldRunTiles ? tiles : [];
  for (let i = 0; i < effectiveTiles.length; i++) {
    const tileId = `tile-${i + 1}`;
    const extracted = await extractCrop(rgba, effectiveTiles[i], tileId);
    tileCropBuffers.push(extracted.pngBuffer);
    crops.push(extracted.crop);

    try {
      const result = await detectForCrop(tileId, 'tile', extracted.pngBuffer.toString('base64'), extracted.crop.sentWidth, extracted.crop.sentHeight, tilePromptContext(i, effectiveTiles.length));
      callOutcomes.push({ cropId: tileId, variant: 'tile', success: true, elapsedMs: result.elapsedMs, detectionCount: result.result.objects.length + result.result.rooms.length });
      requestIds.push(result.requestId);
      addUsage(result.usage);
      modelWarnings.push(...result.result.warnings.map((w) => `[${tileId}] ${w}`));
      tileObjectMetrics.push(result.result.objectMetrics);
      tileRoomMetrics.push(result.result.roomMetrics);

      saveVisionDetectionDiagnostics(diagnosticsId, tileId, {
        variant: 'tile',
        cropWidth: extracted.crop.sentWidth,
        cropHeight: extracted.crop.sentHeight,
        acceptedObjects: result.result.objects,
        discardedObjects: result.result.discardedObjects,
        objectMetrics: result.result.objectMetrics,
        acceptedRooms: result.result.rooms,
        discardedRooms: result.result.discardedRooms,
        roomMetrics: result.result.roomMetrics,
        requestId: result.requestId,
        elapsedMs: result.elapsedMs,
      });

      for (const room of result.result.rooms) {
        allRooms.push({
          id: room.id,
          type: room.type,
          label: room.label,
          confidence: room.confidence,
          boxOriginalPixels: mapBoxToOriginal(room.box, extracted.crop, originalWidth, originalHeight),
          sourceCropIds: [extracted.crop.id],
        });
      }
      for (const obj of result.result.objects) {
        allObjects.push({
          id: obj.id,
          category: obj.category,
          subcategory: obj.subcategory,
          roomType: obj.roomType,
          confidence: obj.confidence,
          orientationDegrees: obj.orientationDegrees,
          boxOriginalPixels: mapBoxToOriginal(obj.box, extracted.crop, originalWidth, originalHeight),
          polygonOriginalPixels: obj.polygon ? mapPolygonToOriginal(obj.polygon, extracted.crop, originalWidth, originalHeight) : null,
          replaceable: obj.replaceable,
          notes: obj.notes,
          sourceCropIds: [extracted.crop.id],
        });
      }
    } catch (err) {
      const elapsedMs = err && typeof err === 'object' && typeof (err as Record<string, unknown>).elapsedMs === 'number' ? ((err as Record<string, unknown>).elapsedMs as number) : 0;
      callOutcomes.push({ cropId: tileId, variant: 'tile', success: false, elapsedMs, errorMessage: sanitizeErrorForOutcome(err) });
      // Deliberately swallowed — a failing tile must not stop the next tile or discard what already succeeded.
    }
  }

  const dedupedObjects = dedupeOpenAIObjects(allObjects);
  const dedupedRooms = dedupeOpenAIRooms(allRooms);

  const maskResult = await buildFloorplanMask(imageBuffer);

  const combined = await combineOpenAIWithStructure(dedupedObjects, dedupedRooms, maskResult.protectedMask, originalWidth, originalHeight);

  maskResult.wallsMaskOriginalRes.delete();
  maskResult.textProtectionMaskOriginalRes.delete();

  const totalTimeMs = Date.now() - startedAt;
  const callCount = getOpenAiVisionCallCount() - callCountBefore;

  return {
    report: {
      objects: combined.objects,
      rooms: combined.rooms,
      originalWidth,
      originalHeight,
      usefulArea,
      crops,
      callOutcomes,
      requestIds,
      usageTotals,
      modelWarnings,
      model: OPENAI_VISION_MODEL,
      callCount,
      totalTimeMs,
      visionMetrics: {
        overviewObjects: overviewResult.result.objectMetrics,
        overviewRooms: overviewResult.result.roomMetrics,
        tileObjects: tileObjectMetrics,
        tileRooms: tileRoomMetrics,
      },
      tilesRan: shouldRunTiles && effectiveTiles.length > 0,
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
