/**
 * Local test suite for the PRE/POST-FLUX text preservation layer:
 *  - lib/floorplanMask/textGrouping.ts (phase 1: group glyph-sized components
 *    into word/label-sized regions, before they're added to the protected
 *    mask in buildMask.ts);
 *  - restoreProtectedTextRegions in lib/floorplanMask/floorplanValidation.ts
 *    (phase 2: hard pixel-for-pixel restoration of every protected text
 *    region after FLUX, wired into validateAndFinalizeResult).
 *
 * Runs entirely offline — pure OpenCV, no network call, no credits spent.
 *
 * Run with: npx tsx scripts/test-text-preservation.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getOpenCv } from '../src/lib/floorplanMask/opencvRuntime';
import { groupTextRegions, scaleRegionsToOriginal } from '../src/lib/floorplanMask/textGrouping';
import { restoreProtectedTextRegions } from '../src/lib/floorplanMask/floorplanValidation';
import { buildFloorplanMask } from '../src/lib/floorplanMask/buildMask';
import { Jimp } from 'jimp';

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
  console.log('Text preservation layer (grouping + hard restoration) — local tests\n');
  const cv = await getOpenCv();

  // --- 1) Grouping merges nearby glyphs into ONE word/label region, not several disjoint ones ---
  await test('groupTextRegions merges several nearby glyph-sized components into a single label region', async () => {
    const width = 400, height = 300;
    const textMask = cv.Mat.zeros(height, width, cv.CV_8UC1);
    // Three small "digits" spaced a few pixels apart, simulating "A: 13,00 m²" — same pattern makeSyntheticFloorplan() in test-floorplan-mask.ts uses.
    for (const [ox, oy] of [[100, 100], [112, 100], [124, 100]]) {
      cv.rectangle(textMask, new cv.Point(ox, oy), new cv.Point(ox + 8, oy + 12), new cv.Scalar(255), -1);
    }
    const { mask, regions } = await groupTextRegions(textMask, 5);
    assert.equal(regions.length, 1, 'three nearby glyphs must merge into one label region, not three separate ones');
    // The merged region must fully contain all three glyphs.
    assert.ok(regions[0].x <= 100 && regions[0].x + regions[0].width >= 132);
    textMask.delete();
    mask.delete();
  });

  await test('groupTextRegions expands the merged region by the configured margin', async () => {
    const width = 400, height = 300;
    const textMask = cv.Mat.zeros(height, width, cv.CV_8UC1);
    cv.rectangle(textMask, new cv.Point(100, 100), new cv.Point(120, 115), new cv.Scalar(255), -1);
    const noMargin = await groupTextRegions(textMask, 0);
    const withMargin = await groupTextRegions(textMask, 15);
    assert.equal(noMargin.regions.length, 1);
    assert.equal(withMargin.regions.length, 1);
    assert.ok(withMargin.regions[0].width > noMargin.regions[0].width, 'a larger configured margin must produce a larger protected region');
    assert.ok(withMargin.regions[0].x < noMargin.regions[0].x, 'margin must expand on the left/top too, not only bottom-right');
    textMask.delete();
    noMargin.mask.delete();
    withMargin.mask.delete();
  });

  await test('groupTextRegions returns no regions and an all-zero mask for a blank (no text) input', async () => {
    const width = 200, height = 150;
    const textMask = cv.Mat.zeros(height, width, cv.CV_8UC1);
    const { mask, regions } = await groupTextRegions(textMask, 10);
    assert.equal(regions.length, 0);
    assert.equal(cv.countNonZero(mask), 0);
    textMask.delete();
    mask.delete();
  });

  await test('scaleRegionsToOriginal scales and clamps regions to the original image bounds', () => {
    const regions = [{ x: 10, y: 10, width: 20, height: 15 }];
    const scaled = scaleRegionsToOriginal(regions, 2, 1000, 1000);
    assert.deepEqual(scaled[0], { x: 20, y: 20, width: 40, height: 30 });
    const clamped = scaleRegionsToOriginal([{ x: 490, y: 490, width: 20, height: 20 }], 2, 500, 500);
    assert.ok(clamped[0].x + clamped[0].width <= 500 && clamped[0].y + clamped[0].height <= 500, 'must clamp to the original image bounds, never exceed them');
  });

  // --- 2) buildFloorplanMask actually protects a whole grouped label, not just isolated glyphs ---
  await test('buildFloorplanMask returns textRegions covering a real label as one grouped region', async () => {
    const width = 600, height = 400;
    const image = new Jimp({ width, height, color: 0xffffffff });
    const black = 0x000000ff;
    for (let t = 0; t < 4; t++) {
      for (let x = 40; x < width - 40; x++) {
        image.setPixelColor(black, x, 40 + t);
        image.setPixelColor(black, x, height - 40 - t);
      }
      for (let y = 40; y < height - 40; y++) {
        image.setPixelColor(black, 40 + t, y);
        image.setPixelColor(black, width - 40 - t, y);
      }
    }
    // A "label" made of several small glyph-sized marks close together.
    for (const [ox, oy] of [[200, 200], [212, 200], [224, 200], [236, 200]]) {
      for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 12; y++) {
          image.setPixelColor(black, ox + x, oy + y);
        }
      }
    }
    const png = await image.getBuffer('image/png');
    const result = await buildFloorplanMask(png);
    assert.ok(result.textRegions.length >= 1, 'at least one grouped text region must be returned');
    const covering = result.textRegions.find((r) => r.x <= 200 && r.x + r.width >= 244);
    assert.ok(covering, 'the 4 nearby glyphs must be covered by a single grouped region, not left as disconnected protection islands');
    result.protectedMask.delete();
    result.wallsMaskOriginalRes.delete();
    result.textProtectionMaskOriginalRes.delete();
  });

  // --- 3) Restoration: a faithfully-reproduced label needs no change (pixelsChanged=0) ---
  await test('restoreProtectedTextRegions reports pixelsChanged=0 for a label FLUX left untouched (original label preserved)', async () => {
    const width = 200, height = 150;
    const original = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    cv.rectangle(original, new cv.Point(50, 50), new cv.Point(90, 70), new cv.Scalar(0, 0, 0, 255), -1);
    const generated = new cv.Mat();
    original.copyTo(generated); // FLUX reproduced it perfectly

    const region = { x: 45, y: 45, width: 50, height: 30 };
    const { corrected, restorations } = await restoreProtectedTextRegions(original, generated, [region]);
    assert.equal(restorations.length, 1);
    assert.equal(restorations[0].pixelsChanged, 0, 'a faithfully-reproduced label must need zero pixel changes');
    assert.deepEqual(Array.from(corrected.ucharPtr(60, 70)), Array.from(original.ucharPtr(60, 70)));

    original.delete();
    generated.delete();
    corrected.delete();
  });

  // --- 4) Restoration: a CORRUPTED label is restored pixel-for-pixel ---
  await test('restoreProtectedTextRegions restores a corrupted/altered label back to the exact original pixels', async () => {
    const width = 200, height = 150;
    const original = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    cv.rectangle(original, new cv.Point(50, 50), new cv.Point(90, 70), new cv.Scalar(0, 0, 0, 255), -1);

    const generated = new cv.Mat();
    original.copyTo(generated);
    // FLUX corrupted the label — painted it solid red instead.
    cv.rectangle(generated, new cv.Point(50, 50), new cv.Point(90, 70), new cv.Scalar(255, 0, 0, 255), -1);

    const region = { x: 45, y: 45, width: 50, height: 30 };
    const { corrected, restorations } = await restoreProtectedTextRegions(original, generated, [region]);
    assert.ok(restorations[0].pixelsChanged > 0, 'a corrupted label must be reported as changed');
    // Center of the label must now match the ORIGINAL exactly, not the corrupted red.
    assert.deepEqual(Array.from(corrected.ucharPtr(60, 70)), [0, 0, 0, 255]);

    original.delete();
    generated.delete();
    corrected.delete();
  });

  // --- 5) No modification outside the restored regions ---
  await test('restoreProtectedTextRegions never touches pixels outside the given regions', async () => {
    const width = 200, height = 150;
    const original = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    const generated = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(0, 255, 0, 255)); // solid green everywhere — simulates FLUX having repainted the whole editable area

    const region = { x: 45, y: 45, width: 50, height: 30 };
    const { corrected } = await restoreProtectedTextRegions(original, generated, [region]);

    // Inside the region: must now be the ORIGINAL's white.
    assert.deepEqual(Array.from(corrected.ucharPtr(60, 70)), [255, 255, 255, 255]);
    // Outside the region: must remain exactly what "FLUX" produced (green) — restoration must not leak beyond the region.
    assert.deepEqual(Array.from(corrected.ucharPtr(10, 10)), [0, 255, 0, 255]);
    assert.deepEqual(Array.from(corrected.ucharPtr(120, 150)), [0, 255, 0, 255]);

    original.delete();
    generated.delete();
    corrected.delete();
  });

  // --- 6) Dimensions are always preserved ---
  await test('restoreProtectedTextRegions never changes the image dimensions', async () => {
    const width = 321, height = 217; // deliberately odd/non-round dimensions
    const original = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    const generated = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(10, 20, 30, 255));
    const { corrected } = await restoreProtectedTextRegions(original, generated, [{ x: 5, y: 5, width: 20, height: 20 }]);
    assert.equal(corrected.cols, width);
    assert.equal(corrected.rows, height);
    original.delete();
    generated.delete();
    corrected.delete();
  });

  // --- 7) Zero external calls: neither module imports any network/provider code ---
  await test('textGrouping.ts and the restoration path import no network/provider module', () => {
    const grouping = fs.readFileSync(path.resolve(__dirname, '../src/lib/floorplanMask/textGrouping.ts'), 'utf8');
    const validation = fs.readFileSync(path.resolve(__dirname, '../src/lib/floorplanMask/floorplanValidation.ts'), 'utf8');
    for (const src of [grouping, validation]) {
      const importLines = src.split('\n').filter((line) => line.trim().startsWith('import '));
      for (const line of importLines) {
        assert.ok(!/from ['"]openai['"]/.test(line), `unexpected OpenAI import: ${line}`);
        assert.ok(!/providers\//.test(line), `unexpected provider import: ${line}`);
      }
      assert.ok(!/fetch\(/.test(src));
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
