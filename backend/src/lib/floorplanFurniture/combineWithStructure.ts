import { getOpenCv, OpenCv } from '../floorplanMask/opencvRuntime';
import {
  GEMINI_VISION_FURNITURE_SAFETY_MARGIN_PX,
  GEMINI_VISION_MAX_STRUCTURE_OVERLAP_RATIO,
  GEMINI_VISION_MIN_CONFIDENCE,
} from '../../config/geminiVisionEngine';
import { normalizeBox, normalizePolygon } from './coordinateTransform';
import { DenormalizedDetection, FurnitureDetection } from './types';

type Mat = InstanceType<OpenCv['Mat']>;

export interface CombineResult {
  detections: FurnitureDetection[];
  /** Union of every non-room candidate mask, BEFORE subtracting structure — artifact "08-mascara-bruta-moveis". */
  rawFurnitureMask: Mat;
  /** Same union, AFTER subtracting the (margin-dilated) structural mask — artifact "09-mascara-moveis-pos-estrutura". Only pixels from `replaceable` or `uncertain` objects. */
  structureSubtractedMask: Mat;
}

/** Rasterizes one detection's polygon (or box, if no polygon) into a same-size binary mask (255 = inside the shape). */
function rasterizeDetection(cv: OpenCv, det: DenormalizedDetection, width: number, height: number): Mat {
  const mask = cv.Mat.zeros(height, width, cv.CV_8UC1);
  if (det.polygonOriginalPixels && det.polygonOriginalPixels.length >= 3) {
    const flat = det.polygonOriginalPixels.flatMap(([x, y]) => [Math.round(x), Math.round(y)]);
    const contour = cv.matFromArray(det.polygonOriginalPixels.length, 1, cv.CV_32SC2, flat);
    const contours = new cv.MatVector();
    contours.push_back(contour);
    cv.drawContours(mask, contours, 0, new cv.Scalar(255), -1);
    contour.delete();
    contours.delete();
  } else {
    const [ymin, xmin, ymax, xmax] = det.boxOriginalPixels;
    cv.rectangle(mask, new cv.Point(Math.round(xmin), Math.round(ymin)), new cv.Point(Math.round(xmax), Math.round(ymax)), new cv.Scalar(255), -1);
  }
  return mask;
}

/**
 * The one place Gemini's semantic output and the existing OpenCV structural
 * mask (walls/doors/windows/pillars/arches/stairs/dimensions/text) actually
 * meet. Gemini never gets authority to decide what's structurally
 * protected — every candidate furniture mask here is explicitly clipped
 * against the SAME structural mask buildFloorplanMask.ts already produces,
 * so a hallucinated or misplaced detection can, at worst, be rejected or
 * marked uncertain — it can never make a wall/door/window/text pixel
 * "replaceable".
 */
export async function combineDetectionsWithStructure(
  detections: DenormalizedDetection[],
  structuralProtectedMask: Mat,
  originalWidth: number,
  originalHeight: number,
  minConfidence: number = GEMINI_VISION_MIN_CONFIDENCE,
  maxStructureOverlapRatio: number = GEMINI_VISION_MAX_STRUCTURE_OVERLAP_RATIO,
  safetyMarginPx: number = GEMINI_VISION_FURNITURE_SAFETY_MARGIN_PX
): Promise<CombineResult> {
  const cv = await getOpenCv();

  const dilateKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(safetyMarginPx * 2 + 1, safetyMarginPx * 2 + 1));
  const dilatedStructure = new cv.Mat();
  cv.dilate(structuralProtectedMask, dilatedStructure, dilateKernel);
  dilateKernel.delete();

  const rawFurnitureMask = cv.Mat.zeros(originalHeight, originalWidth, cv.CV_8UC1);
  const structureSubtractedMask = cv.Mat.zeros(originalHeight, originalWidth, cv.CV_8UC1);

  const results: FurnitureDetection[] = [];
  let nextId = 1;

  for (const det of detections) {
    const boxNormalized = normalizeBox(det.boxOriginalPixels, originalWidth, originalHeight);
    const polygonNormalized = det.polygonOriginalPixels ? normalizePolygon(det.polygonOriginalPixels, originalWidth, originalHeight) : null;

    if (det.category === 'comodo') {
      // Rooms are recognized for context (roomType lookups, artifacts) but
      // are never themselves a "replaceable furniture" region.
      results.push({
        id: `obj-${nextId++}`,
        category: det.category,
        label: det.label,
        roomType: det.roomType,
        confidence: det.confidence,
        boxNormalized,
        boxOriginalPixels: det.boxOriginalPixels,
        polygonNormalized,
        polygonOriginalPixels: det.polygonOriginalPixels,
        replaceable: false,
        uncertain: false,
        reason: 'comodo (contexto de localização — não é uma área substituível)',
      });
      continue;
    }

    if (det.confidence < minConfidence) {
      results.push({
        id: `obj-${nextId++}`,
        category: det.category,
        label: det.label,
        roomType: det.roomType,
        confidence: det.confidence,
        boxNormalized,
        boxOriginalPixels: det.boxOriginalPixels,
        polygonNormalized,
        polygonOriginalPixels: det.polygonOriginalPixels,
        replaceable: false,
        uncertain: false,
        reason: `rejeitado: confiança abaixo do limiar (${det.confidence.toFixed(2)} < ${minConfidence})`,
      });
      continue;
    }

    const candidateMask = rasterizeDetection(cv, det, originalWidth, originalHeight);
    const candidateArea = cv.countNonZero(candidateMask);

    if (candidateArea === 0) {
      results.push({
        id: `obj-${nextId++}`,
        category: det.category,
        label: det.label,
        roomType: det.roomType,
        confidence: det.confidence,
        boxNormalized,
        boxOriginalPixels: det.boxOriginalPixels,
        polygonNormalized,
        polygonOriginalPixels: det.polygonOriginalPixels,
        replaceable: false,
        uncertain: true,
        reason: 'incerto: área candidata vazia após rasterização (caixa/polígono degenerado)',
      });
      candidateMask.delete();
      continue;
    }

    cv.bitwise_or(rawFurnitureMask, candidateMask, rawFurnitureMask);

    const overlapMask = new cv.Mat();
    cv.bitwise_and(candidateMask, dilatedStructure, overlapMask);
    const overlapArea = cv.countNonZero(overlapMask);
    overlapMask.delete();
    const overlapRatio = overlapArea / candidateArea;

    const survivingMask = new cv.Mat();
    const notStructure = new cv.Mat();
    cv.bitwise_not(dilatedStructure, notStructure);
    cv.bitwise_and(candidateMask, notStructure, survivingMask);
    notStructure.delete();
    candidateMask.delete();

    if (overlapRatio > maxStructureOverlapRatio) {
      cv.bitwise_or(structureSubtractedMask, survivingMask, structureSubtractedMask);
      results.push({
        id: `obj-${nextId++}`,
        category: det.category,
        label: det.label,
        roomType: det.roomType,
        confidence: det.confidence,
        boxNormalized,
        boxOriginalPixels: det.boxOriginalPixels,
        polygonNormalized,
        polygonOriginalPixels: det.polygonOriginalPixels,
        replaceable: false,
        uncertain: true,
        reason: `incerto: sobreposição com estrutura protegida acima do limite (${(overlapRatio * 100).toFixed(0)}% > ${(maxStructureOverlapRatio * 100).toFixed(0)}%)`,
      });
      survivingMask.delete();
      continue;
    }

    cv.bitwise_or(structureSubtractedMask, survivingMask, structureSubtractedMask);
    survivingMask.delete();

    results.push({
      id: `obj-${nextId++}`,
      category: det.category,
      label: det.label,
      roomType: det.roomType,
      confidence: det.confidence,
      boxNormalized,
      boxOriginalPixels: det.boxOriginalPixels,
      polygonNormalized,
      polygonOriginalPixels: det.polygonOriginalPixels,
      replaceable: true,
      uncertain: false,
      reason: 'aceito',
    });
  }

  dilatedStructure.delete();

  return { detections: results, rawFurnitureMask, structureSubtractedMask };
}
