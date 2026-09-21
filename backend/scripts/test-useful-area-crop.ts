/**
 * Local test suite for scoping FLUX.1 Fill to the floor plan's actually-drawn
 * area (lib/floorplanMask/usefulAreaCrop.ts) — requirement: "O FLUX não deve
 * editar as grandes áreas brancas externas à planta." Verifies the pixel-exact
 * guarantee the fix is built on: outside the useful-area rect, the final
 * recomposed image is byte-identical to the original, because FLUX never
 * even receives that region.
 *
 * Runs entirely offline — pure OpenCV, no network call, no credits spent.
 *
 * Run with: npx tsx scripts/test-useful-area-crop.ts
 */
import assert from 'node:assert/strict';
import { getOpenCv } from '../src/lib/floorplanMask/opencvRuntime';
import { decodeToMat } from '../src/lib/floorplanMask/imageIO';
import { detectDrawnAreaBoundingBox, extractUsefulAreaCrop, recomposeOntoOriginalCanvas } from '../src/lib/floorplanMask/usefulAreaCrop';

const WIDTH = 800;
const HEIGHT = 600;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log('        ', err instanceof Error ? err.message : err);
    failed++;
  }
}

async function main() {
  console.log('Planta Humanizada — FLUX useful-area crop/recompose, local tests\n');
  const cv = await getOpenCv();

  // A floor-plan-like image: mostly white, with a drawn rectangle (the "plan") in the middle-left, leaving a large blank margin on the right — mirrors the real 2026-09-19 failure shape (huge blank title-block/elevation margin).
  function makeFloorplanLikeImage() {
    const img = new cv.Mat(HEIGHT, WIDTH, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    cv.rectangle(img, new cv.Point(50, 50), new cv.Point(350, 450), new cv.Scalar(0, 0, 0, 255), 3);
    return img;
  }

  await test('detectDrawnAreaBoundingBox finds a tight box around drawn content plus the configured margin', async () => {
    const img = makeFloorplanLikeImage();
    const rect = await detectDrawnAreaBoundingBox(img, 20);
    // Drawn content spans roughly x:[50,350] y:[50,450]; with a 20px margin the box should be close to that, and MUST leave out the large blank right-hand area (x > 400).
    assert.ok(rect.x < 50 && rect.x >= 0, `rect.x should be just before the drawing (got ${rect.x})`);
    assert.ok(rect.x + rect.width < 500, `rect must not extend into the large blank margin (got x+width=${rect.x + rect.width})`);
    assert.ok(rect.y < 50);
    img.delete();
  });

  await test('detectDrawnAreaBoundingBox returns the whole image for a blank input (nothing to crop away)', async () => {
    const blank = new cv.Mat(HEIGHT, WIDTH, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    const rect = await detectDrawnAreaBoundingBox(blank, 20);
    assert.deepEqual(rect, { x: 0, y: 0, width: WIDTH, height: HEIGHT });
    blank.delete();
  });

  await test('extractUsefulAreaCrop produces an image crop and a mask crop with exactly the rect\'s dimensions', async () => {
    const img = makeFloorplanLikeImage();
    const fillMask = cv.Mat.ones(HEIGHT, WIDTH, cv.CV_8UC1); // all-white (all editable) for this test
    fillMask.setTo(new cv.Scalar(255));
    const rect = { x: 30, y: 30, width: 340, height: 440 };
    const crop = await extractUsefulAreaCrop(img, fillMask, rect);
    const { mat: decodedImageCrop } = await decodeToMat(crop.imageCropPng);
    const { mat: decodedMaskCrop } = await decodeToMat(crop.maskCropPng);
    assert.equal(decodedImageCrop.cols, rect.width);
    assert.equal(decodedImageCrop.rows, rect.height);
    assert.equal(decodedMaskCrop.cols, rect.width);
    assert.equal(decodedMaskCrop.rows, rect.height);
    decodedImageCrop.delete();
    decodedMaskCrop.delete();
    img.delete();
    fillMask.delete();
  });

  // --- The core pixel-exact guarantee ---
  await test('recomposeOntoOriginalCanvas preserves the ORIGINAL pixels EXACTLY everywhere outside the useful-area rect', async () => {
    const original = makeFloorplanLikeImage();
    const rect = { x: 30, y: 30, width: 340, height: 440 };

    // A "FLUX result" that is a solid, wildly different color everywhere within the crop — simulates AI content different from the original, so any leak outside the rect would be obvious.
    const resultCrop = new cv.Mat(rect.height, rect.width, cv.CV_8UC4, new cv.Scalar(0, 255, 0, 255));

    const recomposed = await recomposeOntoOriginalCanvas(original, resultCrop, rect);

    // Sample points OUTSIDE the rect (all four sides) must match the ORIGINAL exactly.
    const outsidePoints: [number, number][] = [
      [5, 5], // top-left corner, outside rect
      [WIDTH - 5, 5], // top-right, in the "blank margin"
      [WIDTH - 5, HEIGHT - 5], // bottom-right, in the "blank margin"
      [rect.x - 5, rect.y + 100], // just left of the rect
      [rect.x + 100, rect.y - 5], // just above the rect
      [rect.x + rect.width + 5, rect.y + 100], // just right of the rect
    ];
    for (const [x, y] of outsidePoints) {
      const originalPixel = original.ucharPtr(y, x);
      const recomposedPixel = recomposed.ucharPtr(y, x);
      assert.deepEqual(Array.from(recomposedPixel), Array.from(originalPixel), `pixel at (${x},${y}), outside the useful area, must be byte-identical to the original`);
    }

    // Sample a point INSIDE the rect: must match the (green) result crop, not the original.
    const insideX = rect.x + Math.floor(rect.width / 2);
    const insideY = rect.y + Math.floor(rect.height / 2);
    const insidePixel = recomposed.ucharPtr(insideY, insideX);
    assert.deepEqual(Array.from(insidePixel), [0, 255, 0, 255], 'pixels inside the useful area must come from the FLUX result, not the original');

    original.delete();
    resultCrop.delete();
    recomposed.delete();
  });

  await test('recomposeOntoOriginalCanvas pastes the result at the exact rect position (not off-by-one, not centered)', async () => {
    const original = new cv.Mat(HEIGHT, WIDTH, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    const rect = { x: 100, y: 200, width: 50, height: 60 };
    const resultCrop = new cv.Mat(rect.height, rect.width, cv.CV_8UC4, new cv.Scalar(10, 20, 30, 255));

    const recomposed = await recomposeOntoOriginalCanvas(original, resultCrop, rect);

    // Just outside each edge of the rect must be untouched (white); just inside must be the result color.
    assert.deepEqual(Array.from(recomposed.ucharPtr(rect.y, rect.x - 1)), [255, 255, 255, 255], 'one pixel left of the rect must be untouched');
    assert.deepEqual(Array.from(recomposed.ucharPtr(rect.y, rect.x)), [10, 20, 30, 255], 'the rect\'s own top-left pixel must be the pasted result');
    assert.deepEqual(Array.from(recomposed.ucharPtr(rect.y + rect.height - 1, rect.x + rect.width - 1)), [10, 20, 30, 255], 'the rect\'s own bottom-right pixel must be the pasted result');
    assert.deepEqual(Array.from(recomposed.ucharPtr(rect.y + rect.height, rect.x)), [255, 255, 255, 255], 'one pixel below the rect must be untouched');

    original.delete();
    resultCrop.delete();
    recomposed.delete();
  });

  await test('recomposeOntoOriginalCanvas always returns a canvas with the SAME dimensions as the original, regardless of the rect size', async () => {
    const original = makeFloorplanLikeImage();
    const rect = { x: 30, y: 30, width: 340, height: 440 };
    const resultCrop = new cv.Mat(rect.height, rect.width, cv.CV_8UC4, new cv.Scalar(0, 0, 0, 255));
    const recomposed = await recomposeOntoOriginalCanvas(original, resultCrop, rect);
    assert.equal(recomposed.cols, original.cols);
    assert.equal(recomposed.rows, original.rows);
    original.delete();
    resultCrop.delete();
    recomposed.delete();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
