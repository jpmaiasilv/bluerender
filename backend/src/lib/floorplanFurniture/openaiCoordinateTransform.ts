import { clipPolygonToRect } from './coordinateTransform';
import { OpenAIBox, OpenAIPolygonPoint } from './openaiTypes';
import { SourceCrop } from './types';

/**
 * The ONE place a crop-local pixel coordinate (relative to the exact image
 * OpenAI was sent — see openaiTypes.ts's doc comment on the coordinate
 * convention) is converted into ORIGINAL-image pixel coordinates. Every
 * other module downstream only ever touches already-converted coordinates.
 */
function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

function mapAxis(cropPixel: number, cropOriginalOffset: number, cropOriginalSize: number, sentSize: number): number {
  const fraction = cropPixel / sentSize;
  return cropOriginalOffset + fraction * cropOriginalSize;
}

export function mapBoxToOriginal(box: OpenAIBox, crop: SourceCrop, originalWidth: number, originalHeight: number): OpenAIBox {
  const { rectInOriginal, sentWidth, sentHeight } = crop;
  const xMin = mapAxis(box.xMin, rectInOriginal.x, rectInOriginal.width, sentWidth);
  const xMax = mapAxis(box.xMax, rectInOriginal.x, rectInOriginal.width, sentWidth);
  const yMin = mapAxis(box.yMin, rectInOriginal.y, rectInOriginal.height, sentHeight);
  const yMax = mapAxis(box.yMax, rectInOriginal.y, rectInOriginal.height, sentHeight);

  return {
    xMin: clamp(Math.min(xMin, xMax), originalWidth),
    xMax: clamp(Math.max(xMin, xMax), originalWidth),
    yMin: clamp(Math.min(yMin, yMax), originalHeight),
    yMax: clamp(Math.max(yMin, yMax), originalHeight),
  };
}

/** Maps + clips (Sutherland-Hodgman, reused from coordinateTransform.ts — the geometry is provider-agnostic) a polygon's points to the original image's bounds. */
export function mapPolygonToOriginal(polygon: OpenAIPolygonPoint[], crop: SourceCrop, originalWidth: number, originalHeight: number): OpenAIPolygonPoint[] {
  const { rectInOriginal, sentWidth, sentHeight } = crop;
  const mapped: [number, number][] = polygon.map((p) => [
    mapAxis(p.x, rectInOriginal.x, rectInOriginal.width, sentWidth),
    mapAxis(p.y, rectInOriginal.y, rectInOriginal.height, sentHeight),
  ]);
  const clipped = clipPolygonToRect(mapped, 0, 0, originalWidth, originalHeight);
  return clipped.map(([x, y]) => ({ x, y }));
}
