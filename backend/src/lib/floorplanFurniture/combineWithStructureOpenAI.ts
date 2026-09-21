import { getOpenCv, OpenCv } from '../floorplanMask/opencvRuntime';
import {
  OPENAI_VISION_FURNITURE_SAFETY_MARGIN_PX,
  OPENAI_VISION_MAX_STRUCTURE_OVERLAP_RATIO,
  OPENAI_VISION_MIN_CONFIDENCE,
} from '../../config/openaiModels';
import { DenormalizedOpenAIObject, DenormalizedOpenAIRoom, FinalOpenAIObject, FinalOpenAIRoom } from './openaiTypes';

type Mat = InstanceType<OpenCv['Mat']>;

export interface CombineOpenAIResult {
  objects: FinalOpenAIObject[];
  rooms: FinalOpenAIRoom[];
  /** Union of every candidate object mask, BEFORE subtracting structure. */
  rawFurnitureMask: Mat;
  /** Same union, AFTER subtracting the (margin-dilated) structural mask — only pixels from `replaceable` or `uncertain` objects. */
  structureSubtractedMask: Mat;
}

function rasterizeBox(cv: OpenCv, box: { xMin: number; yMin: number; xMax: number; yMax: number }, width: number, height: number): Mat {
  const mask = cv.Mat.zeros(height, width, cv.CV_8UC1);
  cv.rectangle(mask, new cv.Point(Math.round(box.xMin), Math.round(box.yMin)), new cv.Point(Math.round(box.xMax), Math.round(box.yMax)), new cv.Scalar(255), -1);
  return mask;
}

function rasterizeDetection(cv: OpenCv, det: DenormalizedOpenAIObject, width: number, height: number): Mat {
  if (det.polygonOriginalPixels && det.polygonOriginalPixels.length >= 3) {
    const mask = cv.Mat.zeros(height, width, cv.CV_8UC1);
    const flat = det.polygonOriginalPixels.flatMap((p) => [Math.round(p.x), Math.round(p.y)]);
    const contour = cv.matFromArray(det.polygonOriginalPixels.length, 1, cv.CV_32SC2, flat);
    const contours = new cv.MatVector();
    contours.push_back(contour);
    cv.drawContours(mask, contours, 0, new cv.Scalar(255), -1);
    contour.delete();
    contours.delete();
    return mask;
  }
  return rasterizeBox(cv, det.boxOriginalPixels, width, height);
}

/**
 * The one place OpenAI's semantic output and the existing OpenCV structural
 * mask actually meet. Per explicit requirement: "A OpenAI não pode apagar a
 * proteção estrutural do OpenCV. Ela apenas acrescenta regiões semânticas à
 * máscara" — the model's own `replaceable` self-report (`modelReplaceable`
 * on the output type) is kept for transparency but is NEVER trusted as the
 * pipeline's authority. Every candidate is independently clipped against
 * the SAME structural mask buildFloorplanMask.ts already produces, exactly
 * like the (currently inactive) Gemini path in combineWithStructure.ts — a
 * misplaced or over-eager `replaceable: true` from the model can, at worst,
 * be downgraded to uncertain or rejected here, never granted authority over
 * a protected pixel.
 */
export async function combineOpenAIWithStructure(
  objects: DenormalizedOpenAIObject[],
  rooms: DenormalizedOpenAIRoom[],
  structuralProtectedMask: Mat,
  originalWidth: number,
  originalHeight: number,
  minConfidence: number = OPENAI_VISION_MIN_CONFIDENCE,
  maxStructureOverlapRatio: number = OPENAI_VISION_MAX_STRUCTURE_OVERLAP_RATIO,
  safetyMarginPx: number = OPENAI_VISION_FURNITURE_SAFETY_MARGIN_PX
): Promise<CombineOpenAIResult> {
  const cv = await getOpenCv();

  const dilateKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(safetyMarginPx * 2 + 1, safetyMarginPx * 2 + 1));
  const dilatedStructure = new cv.Mat();
  cv.dilate(structuralProtectedMask, dilatedStructure, dilateKernel);
  dilateKernel.delete();

  const rawFurnitureMask = cv.Mat.zeros(originalHeight, originalWidth, cv.CV_8UC1);
  const structureSubtractedMask = cv.Mat.zeros(originalHeight, originalWidth, cv.CV_8UC1);

  const finalObjects: FinalOpenAIObject[] = [];

  for (const det of objects) {
    const commonFields = {
      id: det.id,
      category: det.category,
      subcategory: det.subcategory,
      roomType: det.roomType,
      confidence: det.confidence,
      orientationDegrees: det.orientationDegrees,
      boxOriginalPixels: det.boxOriginalPixels,
      polygonOriginalPixels: det.polygonOriginalPixels,
      modelReplaceable: det.replaceable,
      notes: det.notes,
    };

    if (det.confidence < minConfidence) {
      finalObjects.push({ ...commonFields, replaceable: false, uncertain: false, reason: `rejeitado: confiança abaixo do limiar (${det.confidence.toFixed(2)} < ${minConfidence})` });
      continue;
    }

    const candidateMask = rasterizeDetection(cv, det, originalWidth, originalHeight);
    const candidateArea = cv.countNonZero(candidateMask);

    if (candidateArea === 0) {
      finalObjects.push({ ...commonFields, replaceable: false, uncertain: true, reason: 'incerto: área candidata vazia após rasterização (caixa/polígono degenerado)' });
      candidateMask.delete();
      continue;
    }

    cv.bitwise_or(rawFurnitureMask, candidateMask, rawFurnitureMask);

    const overlapMask = new cv.Mat();
    cv.bitwise_and(candidateMask, dilatedStructure, overlapMask);
    const overlapArea = cv.countNonZero(overlapMask);
    overlapMask.delete();
    const overlapRatio = overlapArea / candidateArea;

    const notStructure = new cv.Mat();
    cv.bitwise_not(dilatedStructure, notStructure);
    const survivingMask = new cv.Mat();
    cv.bitwise_and(candidateMask, notStructure, survivingMask);
    notStructure.delete();
    candidateMask.delete();

    if (overlapRatio > maxStructureOverlapRatio) {
      cv.bitwise_or(structureSubtractedMask, survivingMask, structureSubtractedMask);
      survivingMask.delete();
      finalObjects.push({
        ...commonFields,
        replaceable: false,
        uncertain: true,
        reason: `incerto: sobreposição com estrutura protegida acima do limite (${(overlapRatio * 100).toFixed(0)}% > ${(maxStructureOverlapRatio * 100).toFixed(0)}%)`,
      });
      continue;
    }

    cv.bitwise_or(structureSubtractedMask, survivingMask, structureSubtractedMask);
    survivingMask.delete();

    finalObjects.push({ ...commonFields, replaceable: true, uncertain: false, reason: 'aceito' });
  }

  dilatedStructure.delete();

  const finalRooms: FinalOpenAIRoom[] = rooms.map((r) => ({
    id: r.id,
    type: r.type,
    label: r.label,
    confidence: r.confidence,
    boxOriginalPixels: r.boxOriginalPixels,
  }));

  return { objects: finalObjects, rooms: finalRooms, rawFurnitureMask, structureSubtractedMask };
}
