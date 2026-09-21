import { OpenAIBox } from './openaiTypes';
import { DenormalizedOpenAIObject, DenormalizedOpenAIRoom } from './openaiTypes';

/** Standard intersection-over-union of two axis-aligned boxes, both already in the same (original-image) coordinate space. */
export function boxIouOpenAI(a: OpenAIBox, b: OpenAIBox): number {
  const interX0 = Math.max(a.xMin, b.xMin);
  const interY0 = Math.max(a.yMin, b.yMin);
  const interX1 = Math.min(a.xMax, b.xMax);
  const interY1 = Math.min(a.yMax, b.yMax);
  const interWidth = Math.max(0, interX1 - interX0);
  const interHeight = Math.max(0, interY1 - interY0);
  const interArea = interWidth * interHeight;

  const areaA = Math.max(0, a.xMax - a.xMin) * Math.max(0, a.yMax - a.yMin);
  const areaB = Math.max(0, b.xMax - b.xMin) * Math.max(0, b.yMax - b.yMin);
  const union = areaA + areaB - interArea;

  return union > 0 ? interArea / union : 0;
}

function center(box: OpenAIBox): { x: number; y: number } {
  return { x: (box.xMin + box.xMax) / 2, y: (box.yMin + box.yMax) / 2 };
}

function dims(box: OpenAIBox): { width: number; height: number } {
  return { width: box.xMax - box.xMin, height: box.yMax - box.yMin };
}

/** Relative difference, 0 = identical, 1 = one of the two is twice (or more) the other. */
function relativeDimensionDelta(a: number, b: number): number {
  const larger = Math.max(a, b);
  const smaller = Math.min(a, b);
  if (larger <= 0) return 0;
  return 1 - smaller / larger;
}

export interface DedupeOptions {
  iouThreshold: number;
  /** Two boxes' centers within this fraction of the larger box's diagonal are considered "the same place" even if IoU alone is borderline. */
  centerDistanceFraction: number;
  /** Two boxes' width/height must not differ by more than this fraction to be considered the same object. */
  maxDimensionDelta: number;
}

const DEFAULT_OPTIONS: DedupeOptions = { iouThreshold: 0.35, centerDistanceFraction: 0.15, maxDimensionDelta: 0.5 };

/**
 * Merges detections that are almost certainly the SAME physical object seen
 * in more than one crop/tile, using ALL FOUR signals the requirement asks
 * for: category, IoU (area intersection), center proximity, and comparable
 * dimensions — not IoU alone. Two detections merge only when they share a
 * category AND (their boxes overlap enough by IoU, OR their centers are
 * close relative to their size) AND their dimensions are comparable — this
 * catches both "same box, slightly different crop-to-original rounding"
 * (high IoU) and "same object, one tile caught it a bit off-center due to
 * partial visibility at the tile edge" (close center, similar size, lower
 * IoU) cases.
 *
 * A detection WITH a segmentation polygon (only ever a tile-pass result —
 * the overview phase never requests one) is always preferred as the
 * cluster's representative over one without, regardless of confidence —
 * mirrors deduplication.ts's same rule for the Gemini pipeline.
 */
export function dedupeOpenAIObjects(detections: DenormalizedOpenAIObject[], options: Partial<DedupeOptions> = {}): DenormalizedOpenAIObject[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sorted = [...detections].sort((a, b) => {
    const aHasPolygon = a.polygonOriginalPixels ? 1 : 0;
    const bHasPolygon = b.polygonOriginalPixels ? 1 : 0;
    if (aHasPolygon !== bHasPolygon) return bHasPolygon - aHasPolygon;
    return b.confidence - a.confidence;
  });

  const used = new Array(sorted.length).fill(false);
  const merged: DenormalizedOpenAIObject[] = [];

  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue;
    const base = sorted[i];
    used[i] = true;
    const clusterCropIds = new Set(base.sourceCropIds);
    const baseCenter = center(base.boxOriginalPixels);
    const baseDims = dims(base.boxOriginalPixels);
    const baseDiagonal = Math.hypot(baseDims.width, baseDims.height);

    for (let j = i + 1; j < sorted.length; j++) {
      if (used[j]) continue;
      const candidate = sorted[j];
      if (candidate.category !== base.category) continue;

      const iou = boxIouOpenAI(base.boxOriginalPixels, candidate.boxOriginalPixels);
      const candidateCenter = center(candidate.boxOriginalPixels);
      const candidateDims = dims(candidate.boxOriginalPixels);
      const centerDistance = Math.hypot(candidateCenter.x - baseCenter.x, candidateCenter.y - baseCenter.y);
      const centersAreClose = baseDiagonal > 0 && centerDistance / baseDiagonal <= opts.centerDistanceFraction;
      const widthDelta = relativeDimensionDelta(baseDims.width, candidateDims.width);
      const heightDelta = relativeDimensionDelta(baseDims.height, candidateDims.height);
      const dimensionsAreComparable = widthDelta <= opts.maxDimensionDelta && heightDelta <= opts.maxDimensionDelta;

      const sameObject = (iou >= opts.iouThreshold || centersAreClose) && dimensionsAreComparable;
      if (sameObject) {
        used[j] = true;
        candidate.sourceCropIds.forEach((id) => clusterCropIds.add(id));
      }
    }

    merged.push({ ...base, sourceCropIds: Array.from(clusterCropIds) });
  }

  return merged;
}

/** Same clustering logic applied to rooms (no polygon concept for rooms, so it's IoU/center/dimensions only, no polygon-preference tie-break). */
export function dedupeOpenAIRooms(rooms: DenormalizedOpenAIRoom[], options: Partial<DedupeOptions> = {}): DenormalizedOpenAIRoom[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sorted = [...rooms].sort((a, b) => b.confidence - a.confidence);
  const used = new Array(sorted.length).fill(false);
  const merged: DenormalizedOpenAIRoom[] = [];

  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue;
    const base = sorted[i];
    used[i] = true;
    const clusterCropIds = new Set(base.sourceCropIds);
    const baseCenter = center(base.boxOriginalPixels);
    const baseDims = dims(base.boxOriginalPixels);
    const baseDiagonal = Math.hypot(baseDims.width, baseDims.height);

    for (let j = i + 1; j < sorted.length; j++) {
      if (used[j]) continue;
      const candidate = sorted[j];
      if (candidate.type !== base.type) continue;

      const iou = boxIouOpenAI(base.boxOriginalPixels, candidate.boxOriginalPixels);
      const candidateCenter = center(candidate.boxOriginalPixels);
      const centerDistance = Math.hypot(candidateCenter.x - baseCenter.x, candidateCenter.y - baseCenter.y);
      const centersAreClose = baseDiagonal > 0 && centerDistance / baseDiagonal <= opts.centerDistanceFraction;

      if (iou >= opts.iouThreshold || centersAreClose) {
        used[j] = true;
        candidate.sourceCropIds.forEach((id) => clusterCropIds.add(id));
      }
    }

    merged.push({ ...base, sourceCropIds: Array.from(clusterCropIds) });
  }

  return merged;
}
