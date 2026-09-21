import { Box, DenormalizedDetection } from './types';

/** Standard intersection-over-union of two [ymin,xmin,ymax,xmax] boxes, both already in the same (original-image) coordinate space. */
export function boxIou(a: Box, b: Box): number {
  const [ay0, ax0, ay1, ax1] = a;
  const [by0, bx0, by1, bx1] = b;

  const interX0 = Math.max(ax0, bx0);
  const interY0 = Math.max(ay0, by0);
  const interX1 = Math.min(ax1, bx1);
  const interY1 = Math.min(ay1, by1);
  const interWidth = Math.max(0, interX1 - interX0);
  const interHeight = Math.max(0, interY1 - interY0);
  const interArea = interWidth * interHeight;

  const areaA = Math.max(0, ax1 - ax0) * Math.max(0, ay1 - ay0);
  const areaB = Math.max(0, bx1 - bx0) * Math.max(0, by1 - by0);
  const union = areaA + areaB - interArea;

  return union > 0 ? interArea / union : 0;
}

/**
 * Merges detections that are almost certainly the SAME physical object seen
 * in more than one crop/tile (per requirement: "una detecções repetidas
 * usando classe, interseção das áreas e proximidade"). Two detections merge
 * only when they share a category AND their boxes overlap enough (IoU) —
 * this doubles as the "proximity" signal, since boxes that are merely near
 * each other without real overlap are left as separate objects (this is
 * standard practice for this kind of dedup, equivalent to greedy
 * non-max-suppression clustering).
 *
 * Which detection in a cluster becomes the representative is NOT just
 * "highest confidence" — a detection WITH a segmentation polygon (always a
 * tile-pass result, since the overview pass never requests one; see
 * providers/geminiVision.ts's two variants) is always preferred over one
 * without, regardless of confidence. The overview's job is only to locate
 * objects; a tile's refined polygon is strictly more useful for building
 * the actual furniture mask, so it must win even if the overview happened
 * to report a slightly higher confidence for the same object. Confidence is
 * only the tie-breaker between two candidates that are equally
 * polygon-having (or equally not). Every crop id in the cluster is
 * preserved on the representative for diagnostics.
 */
export function dedupeDetections(detections: DenormalizedDetection[], iouThreshold = 0.35): DenormalizedDetection[] {
  const sorted = [...detections].sort((a, b) => {
    const aHasPolygon = a.polygonOriginalPixels ? 1 : 0;
    const bHasPolygon = b.polygonOriginalPixels ? 1 : 0;
    if (aHasPolygon !== bHasPolygon) return bHasPolygon - aHasPolygon;
    return b.confidence - a.confidence;
  });
  const used = new Array(sorted.length).fill(false);
  const merged: DenormalizedDetection[] = [];

  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue;
    const base = sorted[i];
    used[i] = true;
    const clusterCropIds = new Set(base.sourceCropIds);

    for (let j = i + 1; j < sorted.length; j++) {
      if (used[j]) continue;
      const candidate = sorted[j];
      if (candidate.category !== base.category) continue;
      if (boxIou(base.boxOriginalPixels, candidate.boxOriginalPixels) >= iouThreshold) {
        used[j] = true;
        candidate.sourceCropIds.forEach((id) => clusterCropIds.add(id));
      }
    }

    merged.push({ ...base, sourceCropIds: Array.from(clusterCropIds) });
  }

  return merged;
}
