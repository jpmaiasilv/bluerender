/**
 * Local test suite for the Planta Humanizada Fill pipeline (requirement #10:
 * "Antes de executar chamadas pagas, crie testes locais"). Runs entirely
 * offline — no network calls, no BFL API key needed, no credits spent.
 *
 * Run with: npx tsx backend/scripts/test-floorplan-mask.ts
 */
import assert from 'node:assert/strict';
import { Jimp } from 'jimp';
import { getOpenCv } from '../src/lib/floorplanMask/opencvRuntime';
import { buildFloorplanMask } from '../src/lib/floorplanMask/buildMask';
import { decodeMaskToProtectedMat } from '../src/lib/floorplanMask/maskIO';
import { decodeToMat, encodeMatToPng } from '../src/lib/floorplanMask/imageIO';
import {
  computeProtectedRegionDeviation,
  detectSuspiciousNewText,
  forceOriginalDimensions,
  overlayOriginalWallLines,
  validateAndFinalizeResult,
} from '../src/lib/floorplanMask/floorplanValidation';

const WIDTH = 600;
const HEIGHT = 400;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
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

/** A synthetic but structurally realistic floor-plan-like PNG: a black
 * rectangular outline (walls), a filled gray rectangle inside (furniture),
 * and a few tiny dark marks (dimension/text-like blobs) — built entirely in
 * code so the test suite has no external fixture-file dependency. */
async function makeSyntheticFloorplan(): Promise<Buffer> {
  const image = new Jimp({ width: WIDTH, height: HEIGHT, color: 0xffffffff });
  const black = 0x000000ff;
  const gray = 0x808080ff;

  // Outer wall rectangle (thick border).
  for (let t = 0; t < 6; t++) {
    for (let x = 40; x < WIDTH - 40; x++) {
      image.setPixelColor(black, x, 40 + t);
      image.setPixelColor(black, x, HEIGHT - 40 - t);
    }
    for (let y = 40; y < HEIGHT - 40; y++) {
      image.setPixelColor(black, 40 + t, y);
      image.setPixelColor(black, WIDTH - 40 - t, y);
    }
  }

  // An interior dividing wall.
  for (let t = 0; t < 4; t++) {
    for (let y = 40; y < HEIGHT - 40; y++) {
      image.setPixelColor(black, WIDTH / 2 + t, y);
    }
  }

  // A furniture-like solid block (e.g. a bed/sofa).
  for (let x = 80; x < 200; x++) {
    for (let y = 80; y < 160; y++) {
      image.setPixelColor(gray, x, y);
    }
  }

  // Small dark marks simulating dimension figures / room numbers.
  for (const [ox, oy] of [
    [100, 300],
    [130, 300],
    [160, 300],
  ]) {
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 12; y++) {
        image.setPixelColor(black, ox + x, oy + y);
      }
    }
  }

  return image.getBuffer('image/png');
}

async function makeBlankImage(): Promise<Buffer> {
  const image = new Jimp({ width: WIDTH, height: HEIGHT, color: 0xffffffff });
  return image.getBuffer('image/png');
}

async function main() {
  console.log('Planta Humanizada — Fill pipeline local tests\n');

  // Warm the OpenCV WASM runtime once up front so later timing isn't skewed.
  await getOpenCv();

  const floorplanPng = await makeSyntheticFloorplan();
  const blankPng = await makeBlankImage();

  // --- 1) Mask generation ---
  await test('buildFloorplanMask produces a same-size, strictly binary PNG mask with both protected and editable areas', async () => {
    const result = await buildFloorplanMask(floorplanPng);
    assert.equal(result.originalWidth, WIDTH);
    assert.equal(result.originalHeight, HEIGHT);

    const { mat: maskRgba, width, height } = await decodeToMat(result.maskPng);
    assert.equal(width, WIDTH);
    assert.equal(height, HEIGHT);

    const cv = await getOpenCv();
    const gray = new cv.Mat();
    cv.cvtColor(maskRgba, gray, cv.COLOR_RGBA2GRAY);

    // Strictly binary: every pixel is 0 or 255, nothing in between.
    const nonBinary = new cv.Mat();
    cv.inRange(gray, new cv.Mat(gray.rows, gray.cols, cv.CV_8UC1, new cv.Scalar(1)), new cv.Mat(gray.rows, gray.cols, cv.CV_8UC1, new cv.Scalar(254)), nonBinary);
    assert.equal(cv.countNonZero(nonBinary), 0, 'mask must only contain pure black/white pixels');

    const whiteCount = cv.countNonZero(gray);
    assert.ok(whiteCount > 0, 'mask must have at least some editable (white) area');
    assert.ok(whiteCount < WIDTH * HEIGHT, 'mask must have at least some protected (black) area — detection should have found the walls');

    maskRgba.delete();
    gray.delete();
    nonBinary.delete();
    result.protectedMask.delete();
    result.wallsMaskOriginalRes.delete();
    result.textProtectionMaskOriginalRes.delete();
  });

  // --- 2) Manual edit (user-painted mask must decode identically to the auto one) ---
  await test('decodeMaskToProtectedMat accepts a hand-edited mask (arbitrary black/white PNG) and rejects mismatched dimensions', async () => {
    const cv = await getOpenCv();
    const edited = new cv.Mat(HEIGHT, WIDTH, cv.CV_8UC1, new cv.Scalar(255));
    cv.rectangle(edited, new cv.Point(250, 150), new cv.Point(350, 250), new cv.Scalar(0), -1); // user painted a "Proteger" square
    const editedRgba = new cv.Mat();
    cv.cvtColor(edited, editedRgba, cv.COLOR_GRAY2RGBA);
    const editedPng = await encodeMatToPng(editedRgba);

    const protectedMat = await decodeMaskToProtectedMat(editedPng, WIDTH, HEIGHT);
    assert.equal(protectedMat.cols, WIDTH);
    assert.equal(protectedMat.rows, HEIGHT);
    // The square the "user" protected must read back as protected (255).
    const sample = protectedMat.ucharPtr(200, 300)[0];
    assert.equal(sample, 255, 'user-protected region must decode as protected');

    await assert.rejects(() => decodeMaskToProtectedMat(editedPng, WIDTH + 10, HEIGHT), /dimensions/i);

    edited.delete();
    editedRgba.delete();
    protectedMat.delete();
  });

  // --- 3) Final overlay (original wall lines are pixel-exact regardless of what the "generated" image contains there) ---
  await test('overlayOriginalWallLines forces protected wall pixels back to the exact original values', async () => {
    const cv = await getOpenCv();
    const { mat: originalRgba } = await decodeToMat(floorplanPng);
    const maskResult = await buildFloorplanMask(floorplanPng);

    // Simulate a "generated" image that painted EVERYTHING solid red — including the walls.
    const fakeGenerated = new cv.Mat(HEIGHT, WIDTH, cv.CV_8UC4, new cv.Scalar(255, 0, 0, 255));

    const corrected = await overlayOriginalWallLines(originalRgba, fakeGenerated, maskResult.wallsMaskOriginalRes);

    // Sample a pixel known to be on the outer wall (per makeSyntheticFloorplan: y=42, any x in range).
    const wallPixel = corrected.ucharPtr(42, 300);
    const originalWallPixel = originalRgba.ucharPtr(42, 300);
    assert.deepEqual(Array.from(wallPixel), Array.from(originalWallPixel), 'wall pixel must be forced back to the original, not left red');

    // A pixel far from any wall (x=150 is clear of the outer border x<46/>554,
    // the interior dividing wall at x≈300-304, and the furniture block's
    // y-range 80-160) should still be the fake generated red.
    const interiorPixel = corrected.ucharPtr(200, 150);
    assert.equal(interiorPixel[0], 255);
    assert.equal(interiorPixel[1], 0);

    originalRgba.delete();
    fakeGenerated.delete();
    corrected.delete();
    maskResult.protectedMask.delete();
    maskResult.wallsMaskOriginalRes.delete();
    maskResult.textProtectionMaskOriginalRes.delete();
  });

  // --- 4) Dimension preservation ---
  await test('forceOriginalDimensions resizes a mismatched "generated" image back to the exact original size', async () => {
    const cv = await getOpenCv();
    const wrongSize = new cv.Mat(HEIGHT - 50, WIDTH - 80, cv.CV_8UC4, new cv.Scalar(10, 20, 30, 255));
    const fixed = await forceOriginalDimensions(wrongSize, WIDTH, HEIGHT);
    assert.equal(fixed.cols, WIDTH);
    assert.equal(fixed.rows, HEIGHT);
    wrongSize.delete();
    fixed.delete();
  });

  // --- 5) Error handling ---
  await test('buildFloorplanMask rejects a corrupt/non-image buffer with a clear error instead of crashing', async () => {
    const garbage = Buffer.from('this is not a real image file, just plain text bytes');
    await assert.rejects(() => buildFloorplanMask(garbage));
  });

  await test('decodeMaskToProtectedMat rejects a corrupt mask buffer with a clear error', async () => {
    const garbage = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    await assert.rejects(() => decodeMaskToProtectedMat(garbage, WIDTH, HEIGHT));
  });

  // --- 6) Image with no detectable walls ---
  await test('buildFloorplanMask handles a blank image (no walls/furniture/text) without crashing, producing an all/mostly-editable mask', async () => {
    const result = await buildFloorplanMask(blankPng);
    const { mat: maskRgba } = await decodeToMat(result.maskPng);
    const cv = await getOpenCv();
    const gray = new cv.Mat();
    cv.cvtColor(maskRgba, gray, cv.COLOR_RGBA2GRAY);
    const whiteRatio = cv.countNonZero(gray) / (WIDTH * HEIGHT);
    assert.ok(whiteRatio > 0.95, `a blank input should be almost entirely editable (got ${(whiteRatio * 100).toFixed(1)}% white)`);
    maskRgba.delete();
    gray.delete();
    result.protectedMask.delete();
    result.wallsMaskOriginalRes.delete();
    result.textProtectionMaskOriginalRes.delete();
  });

  // --- Bonus: full validateAndFinalizeResult pipeline, including rejection on excessive deviation ---
  await test('validateAndFinalizeResult accepts a faithful "generation" and rejects a wildly different one', async () => {
    const { mat: originalRgba } = await decodeToMat(floorplanPng);
    const maskResult = await buildFloorplanMask(floorplanPng);
    const cv = await getOpenCv();

    // Faithful case: generated == original (deviation should be ~0, accepted).
    const faithful = new cv.Mat();
    originalRgba.copyTo(faithful);
    const faithfulResult = await validateAndFinalizeResult(
      originalRgba,
      faithful,
      maskResult.protectedMask,
      maskResult.wallsMaskOriginalRes,
      maskResult.textRegions,
      WIDTH,
      HEIGHT
    );
    assert.ok(faithfulResult.deviationAccepted, `faithful generation should pass the deviation gate (deviation=${faithfulResult.deviation})`);
    faithfulResult.correctedRgba.delete();

    // Unfaithful case: generated is solid noise-like color everywhere (deviation should be high, rejected).
    const unfaithful = new cv.Mat(HEIGHT, WIDTH, cv.CV_8UC4, new cv.Scalar(0, 255, 0, 255));
    const unfaithfulResult = await validateAndFinalizeResult(
      originalRgba,
      unfaithful,
      maskResult.protectedMask,
      maskResult.wallsMaskOriginalRes,
      maskResult.textRegions,
      WIDTH,
      HEIGHT
    );
    assert.ok(!unfaithfulResult.deviationAccepted, `wildly different generation should fail the deviation gate (deviation=${unfaithfulResult.deviation})`);
    unfaithfulResult.correctedRgba.delete();

    originalRgba.delete();
    faithful.delete();
    unfaithful.delete();
    maskResult.protectedMask.delete();
    maskResult.wallsMaskOriginalRes.delete();
    maskResult.textProtectionMaskOriginalRes.delete();
  });

  // --- Suspicious-text detection: flags NEW text-like marks invented in editable areas, ignores marks the model faithfully reproduced inside protected areas ---
  await test('detectSuspiciousNewText flags invented text in editable areas but not text already protected in the original', async () => {
    const { mat: originalRgba } = await decodeToMat(floorplanPng);
    const maskResult = await buildFloorplanMask(floorplanPng);
    const cv = await getOpenCv();

    // Case A: "generation" identical to the original — the existing dimension
    // marks are already inside the protected mask, so nothing new appears
    // outside it. Must NOT be flagged.
    const faithful = new cv.Mat();
    originalRgba.copyTo(faithful);
    const faithfulCheck = await detectSuspiciousNewText(faithful, maskResult.protectedMask);
    assert.ok(!faithfulCheck.suspicious, `faithful reproduction should not be flagged (blobs=${faithfulCheck.newTextBlobCount})`);
    faithful.delete();

    // Case B: "generation" that hallucinated several small dark text-like
    // marks deep inside the open (editable) floor area, far from any wall,
    // furniture or the original dimension marks. Must be flagged.
    const hallucinated = new cv.Mat();
    originalRgba.copyTo(hallucinated);
    for (const [ox, oy] of [
      [250, 90],
      [280, 90],
      [310, 90],
    ]) {
      cv.rectangle(hallucinated, new cv.Point(ox, oy), new cv.Point(ox + 8, oy + 12), new cv.Scalar(0, 0, 0, 255), -1);
    }
    const hallucinatedCheck = await detectSuspiciousNewText(hallucinated, maskResult.protectedMask);
    assert.ok(hallucinatedCheck.suspicious, `invented text in an editable area should be flagged (blobs=${hallucinatedCheck.newTextBlobCount})`);
    assert.ok(hallucinatedCheck.reason && hallucinatedCheck.reason.length > 0, 'a suspicious result must include a human-readable reason');
    hallucinated.delete();

    originalRgba.delete();
    maskResult.protectedMask.delete();
    maskResult.wallsMaskOriginalRes.delete();
    maskResult.textProtectionMaskOriginalRes.delete();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
