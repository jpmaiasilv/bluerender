import { Box, Point, SourceCrop } from './types';

/** Clamps a single value into [0, max]. */
function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

/** Maps one Gemini-normalized (0-1000) coordinate, relative to a crop's SENT (possibly resized) dimensions, into that crop's position within the original image. */
function mapAxisToOriginal(normalized0to1000: number, cropOriginalOffset: number, cropOriginalSize: number, sentSize: number): number {
  const fraction = normalized0to1000 / 1000;
  const sentPx = fraction * sentSize;
  const scale = cropOriginalSize / sentSize;
  return cropOriginalOffset + sentPx * scale;
}

/**
 * Converts a Gemini box_2d ([ymin,xmin,ymax,xmax], normalized 0-1000
 * relative to the crop that was actually sent) into ORIGINAL image pixel
 * coordinates, clamped to the original image's bounds.
 */
export function denormalizeBox(box_2d: Box, crop: SourceCrop, originalWidth: number, originalHeight: number): Box {
  const [ymin, xmin, ymax, xmax] = box_2d;
  const { rectInOriginal, sentWidth, sentHeight } = crop;

  const x0 = mapAxisToOriginal(xmin, rectInOriginal.x, rectInOriginal.width, sentWidth);
  const x1 = mapAxisToOriginal(xmax, rectInOriginal.x, rectInOriginal.width, sentWidth);
  const y0 = mapAxisToOriginal(ymin, rectInOriginal.y, rectInOriginal.height, sentHeight);
  const y1 = mapAxisToOriginal(ymax, rectInOriginal.y, rectInOriginal.height, sentHeight);

  return [clamp(Math.min(y0, y1), originalHeight), clamp(Math.min(x0, x1), originalWidth), clamp(Math.max(y0, y1), originalHeight), clamp(Math.max(x0, x1), originalWidth)];
}

/** Same mapping as denormalizeBox, applied point-by-point to a segmentation polygon, then clipped to the original image's rectangle (Sutherland-Hodgman) so no vertex — and no edge — ever falls outside the image. */
export function denormalizePolygon(points: Point[], crop: SourceCrop, originalWidth: number, originalHeight: number): Point[] {
  const { rectInOriginal, sentWidth, sentHeight } = crop;
  const mapped: Point[] = points.map(([x, y]) => [
    mapAxisToOriginal(x, rectInOriginal.x, rectInOriginal.width, sentWidth),
    mapAxisToOriginal(y, rectInOriginal.y, rectInOriginal.height, sentHeight),
  ]);
  return clipPolygonToRect(mapped, 0, 0, originalWidth, originalHeight);
}

/** [ymin,xmin,ymax,xmax] pixel box -> 0-1 normalized, relative to the given (original) image dimensions. */
export function normalizeBox(box: Box, width: number, height: number): Box {
  const [ymin, xmin, ymax, xmax] = box;
  return [ymin / height, xmin / width, ymax / height, xmax / width];
}

export function normalizePolygon(points: Point[], width: number, height: number): Point[] {
  return points.map(([x, y]) => [x / width, y / height]);
}

/**
 * Sutherland-Hodgman polygon clipping against an axis-aligned rectangle
 * [minX,minY,maxX,maxY]. Standard 4-pass clip (one pass per rectangle edge)
 * — a small, self-contained implementation rather than pulling in a
 * geometry library for this one operation.
 */
export function clipPolygonToRect(polygon: Point[], minX: number, minY: number, maxX: number, maxY: number): Point[] {
  if (polygon.length === 0) return [];

  type Edge = { inside: (p: Point) => boolean; intersect: (a: Point, b: Point) => Point };
  const edges: Edge[] = [
    { inside: ([x]) => x >= minX, intersect: (a, b) => intersectVertical(a, b, minX) },
    { inside: ([x]) => x <= maxX, intersect: (a, b) => intersectVertical(a, b, maxX) },
    { inside: ([, y]) => y >= minY, intersect: (a, b) => intersectHorizontal(a, b, minY) },
    { inside: ([, y]) => y <= maxY, intersect: (a, b) => intersectHorizontal(a, b, maxY) },
  ];

  let output = polygon;
  for (const edge of edges) {
    if (output.length === 0) break;
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const current = input[i];
      const previous = input[(i - 1 + input.length) % input.length];
      const currentInside = edge.inside(current);
      const previousInside = edge.inside(previous);

      if (currentInside) {
        if (!previousInside) output.push(edge.intersect(previous, current));
        output.push(current);
      } else if (previousInside) {
        output.push(edge.intersect(previous, current));
      }
    }
  }
  return output;
}

function intersectVertical(a: Point, b: Point, x: number): Point {
  const [ax, ay] = a;
  const [bx, by] = b;
  if (bx === ax) return [x, ay];
  const t = (x - ax) / (bx - ax);
  return [x, ay + t * (by - ay)];
}

function intersectHorizontal(a: Point, b: Point, y: number): Point {
  const [ax, ay] = a;
  const [bx, by] = b;
  if (by === ay) return [ax, y];
  const t = (y - ay) / (by - ay);
  return [ax + t * (bx - ax), y];
}
