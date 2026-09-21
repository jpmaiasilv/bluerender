/**
 * Offline-only reconstruction of the two visuals the pipeline itself
 * doesn't persist (the exact crop sent to FLUX, and the recomposed-but-not-
 * yet-wall-corrected canvas) for the third real run, using already-saved
 * real artifacts (the original image, the raw Fill crop result already on
 * disk) plus the real logged usefulAreaRect. No network call, no pipeline
 * code touched — pure post-hoc inspection.
 *
 * Run with: npx tsx scripts/reconstruct-run-03-visuals.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { getOpenCv } from '../src/lib/floorplanMask/opencvRuntime';
import { decodeToMat, encodeMatToPng } from '../src/lib/floorplanMask/imageIO';
import { extractUsefulAreaCrop, recomposeOntoOriginalCanvas } from '../src/lib/floorplanMask/usefulAreaCrop';
import { forceOriginalDimensions } from '../src/lib/floorplanMask/floorplanValidation';

const OUTPUT_DIR = path.resolve(__dirname, '../test-output/humanized-floorplan-real-execution-03');
const usefulAreaRect = { x: 0, y: 377, width: 1755, height: 487 };

async function main() {
  const cv = await getOpenCv();
  const imageBuffer = fs.readFileSync(path.join(OUTPUT_DIR, '01-original.jpg'));
  const rawCropResultBuffer = fs.readFileSync(path.join(OUTPUT_DIR, '07-resultado-bruto-flux.png'));

  const { mat: originalRgba, width: originalWidth, height: originalHeight } = await decodeToMat(imageBuffer);

  const fillMaskFullSize = new cv.Mat(originalHeight, originalWidth, cv.CV_8UC1, new cv.Scalar(255));
  const crop = await extractUsefulAreaCrop(originalRgba, fillMaskFullSize, usefulAreaRect);
  fs.writeFileSync(path.join(OUTPUT_DIR, '05-recorte-enviado-ao-flux.png'), crop.imageCropPng);
  fillMaskFullSize.delete();

  const { mat: rawCropRgba } = await decodeToMat(rawCropResultBuffer);
  const resizedCropResult = await forceOriginalDimensions(rawCropRgba, usefulAreaRect.width, usefulAreaRect.height);
  rawCropRgba.delete();
  const recomposed = await recomposeOntoOriginalCanvas(originalRgba, resizedCropResult, usefulAreaRect);
  resizedCropResult.delete();
  const recomposedPng = await encodeMatToPng(recomposed);
  fs.writeFileSync(path.join(OUTPUT_DIR, '08-resultado-recomposto.png'), recomposedPng);

  let checkedPoints = 0;
  let mismatches = 0;
  const step = 7;
  for (let y = 0; y < originalHeight; y += step) {
    for (let x = 0; x < originalWidth; x += step) {
      const insideRect = x >= usefulAreaRect.x && x < usefulAreaRect.x + usefulAreaRect.width && y >= usefulAreaRect.y && y < usefulAreaRect.y + usefulAreaRect.height;
      if (insideRect) continue;
      checkedPoints++;
      const o = originalRgba.ucharPtr(y, x);
      const r = recomposed.ucharPtr(y, x);
      if (o[0] !== r[0] || o[1] !== r[1] || o[2] !== r[2] || o[3] !== r[3]) mismatches++;
    }
  }

  console.log(JSON.stringify({ usefulAreaRect, checkedPoints, mismatches, pixelExactOutsideRect: mismatches === 0 }, null, 2));

  originalRgba.delete();
  recomposed.delete();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
