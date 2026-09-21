import { GEMINI_VISION_TILE_OVERLAP_FRACTION, GEMINI_VISION_TILE_THRESHOLD_PX } from '../../config/geminiVisionEngine';
import { PixelRect } from './types';

export interface CropPlan {
  overview: PixelRect;
  /** Empty when the useful area is already small enough for a single overview pass to keep every object at a legible size. */
  tiles: PixelRect[];
}

/**
 * Pure geometry — no image data touched here, so this is fully unit
 * testable without OpenCV/real images. Splits the useful area into
 * overlapping tiles only when it's large enough that small furniture could
 * become illegible in a single downscaled overview (requirement: "Se os
 * objetos ficarem pequenos demais, divida a área útil em recortes com
 * sobreposição"). The overview itself is ALWAYS included/returned — tiling
 * only ever adds crops on top of it, per "Faça uma análise geral da planta"
 * (step 4) before any conditional tiling (step 5).
 */
export function planCropRects(
  usefulArea: PixelRect,
  tileThresholdPx: number = GEMINI_VISION_TILE_THRESHOLD_PX,
  overlapFraction: number = GEMINI_VISION_TILE_OVERLAP_FRACTION
): CropPlan {
  const longSide = Math.max(usefulArea.width, usefulArea.height);
  if (longSide <= tileThresholdPx) {
    return { overview: usefulArea, tiles: [] };
  }

  const cols = Math.max(1, Math.ceil(usefulArea.width / tileThresholdPx));
  const rows = Math.max(1, Math.ceil(usefulArea.height / tileThresholdPx));
  const tileWidth = usefulArea.width / cols;
  const tileHeight = usefulArea.height / rows;
  const overlapX = tileWidth * overlapFraction;
  const overlapY = tileHeight * overlapFraction;

  const areaLeft = usefulArea.x;
  const areaTop = usefulArea.y;
  const areaRight = usefulArea.x + usefulArea.width;
  const areaBottom = usefulArea.y + usefulArea.height;

  const tiles: PixelRect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rawX0 = areaLeft + c * tileWidth - overlapX;
      const rawY0 = areaTop + r * tileHeight - overlapY;
      const rawX1 = areaLeft + (c + 1) * tileWidth + overlapX;
      const rawY1 = areaTop + (r + 1) * tileHeight + overlapY;

      const x0 = Math.max(areaLeft, Math.round(rawX0));
      const y0 = Math.max(areaTop, Math.round(rawY0));
      const x1 = Math.min(areaRight, Math.round(rawX1));
      const y1 = Math.min(areaBottom, Math.round(rawY1));

      if (x1 <= x0 || y1 <= y0) continue;
      tiles.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
    }
  }

  return { overview: usefulArea, tiles };
}
