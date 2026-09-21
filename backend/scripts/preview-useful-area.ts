/**
 * OFFLINE preview (no network call of any kind) of the useful-area rect
 * that will be sent to FLUX after the margin-hallucination fix — run
 * against the same real floor plan already used in this project.
 *
 * Run with: npx tsx scripts/preview-useful-area.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { getOpenCv } from '../src/lib/floorplanMask/opencvRuntime';
import { decodeToMat, encodeMatToPng } from '../src/lib/floorplanMask/imageIO';
import { detectDrawnAreaBoundingBox } from '../src/lib/floorplanMask/usefulAreaCrop';
import { HUMANIZED_FLOORPLAN_USEFUL_AREA_MARGIN_PX } from '../src/config/humanizedFloorplanEngine';

const IMAGE_PATH = path.resolve(__dirname, '../test-fixtures/floorplans/planta-tecnica-real-01.jpg');
const OUTPUT_DIR = path.resolve(__dirname, '../test-output/useful-area-preview');

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const cv = await getOpenCv();

  const buffer = fs.readFileSync(IMAGE_PATH);
  const { mat: rgba, width, height } = await decodeToMat(buffer);

  const rect = await detectDrawnAreaBoundingBox(rgba, HUMANIZED_FLOORPLAN_USEFUL_AREA_MARGIN_PX);

  // Darken everything OUTSIDE the rect so it's visually obvious what will
  // never be sent to FLUX (and is therefore guaranteed byte-identical in
  // the final result).
  const preview = new cv.Mat();
  rgba.copyTo(preview);
  const dim = new cv.Mat();
  preview.copyTo(dim);
  cv.rectangle(dim, new cv.Point(0, 0), new cv.Point(width, height), new cv.Scalar(0, 0, 0, 255), -1);
  cv.addWeighted(preview, 0.35, dim, 0.65, 0, preview);
  dim.delete();

  // Restore full brightness INSIDE the rect (only the outside stays dimmed).
  const roi = preview.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height));
  const originalRoi = rgba.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height));
  originalRoi.copyTo(roi);
  originalRoi.delete();
  roi.delete();

  cv.rectangle(preview, new cv.Point(rect.x, rect.y), new cv.Point(rect.x + rect.width, rect.y + rect.height), new cv.Scalar(220, 30, 30, 255), 4);

  const png = await encodeMatToPng(preview);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'useful-area-preview.png'), png);

  const report = {
    imagePath: IMAGE_PATH,
    originalWidth: width,
    originalHeight: height,
    marginPx: HUMANIZED_FLOORPLAN_USEFUL_AREA_MARGIN_PX,
    usefulAreaRect: rect,
    usefulAreaPercentOfImage: Number((((rect.width * rect.height) / (width * height)) * 100).toFixed(1)),
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  rgba.delete();
  preview.delete();
}

main().catch((err) => {
  console.error('Preview script crashed:', err);
  process.exit(1);
});
