/**
 * Local test suite for the POST-verifySuspiciousText local text correction
 * layer (lib/floorplanMask/textCorrection.ts) — attempts to surgically undo
 * a CONFIRMED new-text box using only the original pixels, never a new
 * FLUX/OpenAI call, and only when it's safe to do so.
 *
 * Runs entirely offline — pure OpenCV, no network call, no credits spent.
 *
 * Run with: npx tsx scripts/test-text-correction.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getOpenCv } from '../src/lib/floorplanMask/opencvRuntime';
import { checkRegionUniformity, attemptTextCorrectionAndRevalidate, detectExternalModification } from '../src/lib/floorplanMask/textCorrection';

const STDDEV_THRESHOLD = 14;
const MARGIN_PX = 6;

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
  console.log('Local text correction (post-verifySuspiciousText) — local tests\n');
  const cv = await getOpenCv();
  const width = 400;
  const height = 300;

  // --- 1) checkRegionUniformity itself ---
  await test('checkRegionUniformity reports a blank white region as uniform', async () => {
    const img = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    const result = await checkRegionUniformity(img, { x: 50, y: 50, width: 60, height: 30 }, STDDEV_THRESHOLD);
    assert.ok(result.uniform);
    img.delete();
  });

  await test('checkRegionUniformity reports a textured/checkerboard region as NOT uniform', async () => {
    const img = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    for (let y = 50; y < 80; y++) {
      for (let x = 50; x < 110; x++) {
        const on = (Math.floor(x / 6) + Math.floor(y / 6)) % 2 === 0;
        if (on) img.ucharPtr(y, x).set([90, 60, 30, 255]);
      }
    }
    const result = await checkRegionUniformity(img, { x: 50, y: 50, width: 60, height: 30 }, STDDEV_THRESHOLD);
    assert.ok(!result.uniform, `checkerboard texture should not read as uniform (stdDev=${result.stdDev})`);
    img.delete();
  });

  // --- 2) A watermark hallucinated over a BLANK white background is safely removed ---
  await test('a confirmed new-text box over a blank white background is restored (watermark removed)', async () => {
    const original = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255)); // blank white margin — nothing was ever there
    const generated = new cv.Mat();
    original.copyTo(generated);
    // FLUX hallucinated a dark watermark/logo text on the blank area.
    cv.putText(generated, 'SAFETRVN', new cv.Point(140, 220), cv.FONT_HERSHEY_SIMPLEX, 0.8, new cv.Scalar(20, 20, 20, 255), 2, cv.LINE_AA);
    // Sanity: the hallucination must have actually changed pixels there.
    const beforeCheck = await checkRegionUniformity(generated, { x: 130, y: 190, width: 140, height: 50 }, STDDEV_THRESHOLD);
    assert.ok(!beforeCheck.uniform, 'the hallucinated watermark must make the region read as non-uniform before correction');

    const protectedMask = cv.Mat.zeros(height, width, cv.CV_8UC1); // nothing structurally protected in this synthetic test
    const confirmedBox = { xMin: 135, yMin: 195, xMax: 260, yMax: 235 };
    const outcome = await attemptTextCorrectionAndRevalidate(original, generated, protectedMask, [confirmedBox], MARGIN_PX, STDDEV_THRESHOLD);

    assert.equal(outcome.decisions.length, 1);
    assert.equal(outcome.decisions[0].verdict, 'restored');
    assert.ok(outcome.allSafelyCorrected);
    assert.ok(!outcome.residualSuspiciousText.suspicious, 'after restoring the only hallucinated text, the offline heuristic must find nothing suspicious left');

    // The corrected image, sampled well inside the (former) watermark box, must now match the blank original.
    const sample = outcome.correctedRgba.ucharPtr(215, 200);
    assert.deepEqual(Array.from(sample), [255, 255, 255, 255]);

    original.delete();
    generated.delete();
    protectedMask.delete();
    outcome.correctedRgba.delete();
  });

  // --- 3) A confirmed new-text box over FLOOR TEXTURE is rejected, never patched ---
  await test('a confirmed new-text box over floor texture is rejected (relevant region), never patched', async () => {
    const original = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    // A textured "floor pattern" — small alternating tiles — where the confirmed box lands.
    for (let y = 190; y < 240; y++) {
      for (let x = 130; x < 270; x++) {
        const on = (Math.floor(x / 5) + Math.floor(y / 5)) % 2 === 0;
        original.ucharPtr(y, x).set(on ? [180, 140, 90, 255] : [150, 110, 70, 255]);
      }
    }
    const generated = new cv.Mat();
    original.copyTo(generated);
    cv.putText(generated, 'FAKE', new cv.Point(150, 220), cv.FONT_HERSHEY_SIMPLEX, 0.8, new cv.Scalar(0, 0, 0, 255), 2, cv.LINE_AA);

    const protectedMask = cv.Mat.zeros(height, width, cv.CV_8UC1);
    const confirmedBox = { xMin: 145, yMin: 195, xMax: 220, yMax: 235 };
    const outcome = await attemptTextCorrectionAndRevalidate(original, generated, protectedMask, [confirmedBox], MARGIN_PX, STDDEV_THRESHOLD);

    assert.equal(outcome.decisions[0].verdict, 'rejected_relevant_region');
    assert.ok(!outcome.allSafelyCorrected, 'a box over floor texture must never be treated as safely corrected');

    // The floor texture area must be COMPLETELY untouched by the correction attempt — same pixels as the FLUX output going in (correction never even tried to patch it).
    for (const [x, y] of [[150, 200], [200, 210], [180, 225]]) {
      assert.deepEqual(Array.from(outcome.correctedRgba.ucharPtr(y, x)), Array.from(generated.ucharPtr(y, x)), `pixel (${x},${y}) inside a rejected relevant-region box must not be modified`);
    }

    original.delete();
    generated.delete();
    protectedMask.delete();
    outcome.correctedRgba.delete();
  });

  // --- 4) No modification anywhere outside the confirmed box (+ margin) ---
  await test('attemptTextCorrectionAndRevalidate never modifies pixels outside the confirmed box + margin', async () => {
    const original = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    const generated = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(0, 200, 0, 255)); // solid distinct color everywhere, simulating FLUX's whole editable output
    const protectedMask = cv.Mat.zeros(height, width, cv.CV_8UC1);
    const confirmedBox = { xMin: 100, yMin: 100, xMax: 150, yMax: 130 };
    const outcome = await attemptTextCorrectionAndRevalidate(original, generated, protectedMask, [confirmedBox], MARGIN_PX, STDDEV_THRESHOLD);

    // Far outside the box+margin: must be untouched (still the "FLUX" green).
    assert.deepEqual(Array.from(outcome.correctedRgba.ucharPtr(10, 10)), [0, 200, 0, 255]);
    assert.deepEqual(Array.from(outcome.correctedRgba.ucharPtr(250, 350)), [0, 200, 0, 255]);

    original.delete();
    generated.delete();
    protectedMask.delete();
    outcome.correctedRgba.delete();
  });

  // --- 5) Dimensions are always preserved ---
  await test('attemptTextCorrectionAndRevalidate never changes the image dimensions', async () => {
    const w = 337, h = 211; // deliberately odd dimensions
    const original = new cv.Mat(h, w, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    const generated = new cv.Mat(h, w, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    const protectedMask = cv.Mat.zeros(h, w, cv.CV_8UC1);
    const outcome = await attemptTextCorrectionAndRevalidate(original, generated, protectedMask, [], MARGIN_PX, STDDEV_THRESHOLD);
    assert.equal(outcome.correctedRgba.cols, w);
    assert.equal(outcome.correctedRgba.rows, h);
    original.delete();
    generated.delete();
    protectedMask.delete();
    outcome.correctedRgba.delete();
  });

  // --- 6) An empty confirmed-box list is a safe no-op ---
  await test('an empty confirmedBoxes list is treated as fully (vacuously) safe', async () => {
    const original = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    const generated = new cv.Mat();
    original.copyTo(generated);
    const protectedMask = cv.Mat.zeros(height, width, cv.CV_8UC1);
    const outcome = await attemptTextCorrectionAndRevalidate(original, generated, protectedMask, [], MARGIN_PX, STDDEV_THRESHOLD);
    assert.equal(outcome.decisions.length, 0);
    assert.ok(outcome.allSafelyCorrected);
    original.delete();
    generated.delete();
    protectedMask.delete();
    outcome.correctedRgba.delete();
  });

  // --- 7) Exact reproduction of the 2026-09-19 real run: 18 heuristic candidates, 4 confirmed by OpenAI, 4 corrected, 14 external false positives remain — result must PROCEED (allSafelyCorrected=true) ---
  await test('18 heuristic candidates / 4 OpenAI-confirmed / 4 corrected / 14 external false positives remaining -> proceeds (does not reject)', async () => {
    const w = 900, h = 700;
    const original = new cv.Mat(h, w, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    const generated = new cv.Mat();
    original.copyTo(generated);

    // 4 CONFIRMED hallucinated-text marks — these are the ones OpenAI reported as boundingBoxes.
    const confirmedBoxes = [
      { xMin: 50, yMin: 50, xMax: 66, yMax: 64 },
      { xMin: 150, yMin: 50, xMax: 166, yMax: 64 },
      { xMin: 250, yMin: 50, xMax: 266, yMax: 64 },
      { xMin: 350, yMin: 50, xMax: 366, yMax: 64 },
    ];
    for (const b of confirmedBoxes) {
      cv.rectangle(generated, new cv.Point(b.xMin, b.yMin), new cv.Point(b.xMax, b.yMax), new cv.Scalar(0, 0, 0, 255), -1);
    }

    // 14 EXTERNAL text-like false positives (e.g. furniture/rug texture edges the heuristic misreads) — scattered well away from the 4 confirmed marks, never reported by OpenAI, never in confirmedBoxes.
    let externalCount = 0;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 7; col++) {
        const ox = 50 + col * 60;
        const oy = 300 + row * 60;
        cv.rectangle(generated, new cv.Point(ox, oy), new cv.Point(ox + 10, oy + 14), new cv.Scalar(0, 0, 0, 255), -1);
        externalCount++;
      }
    }
    assert.equal(externalCount, 14, 'test setup sanity check: exactly 14 external marks');

    const protectedMask = cv.Mat.zeros(h, w, cv.CV_8UC1);

    // Sanity: the heuristic (same one the route uses) must actually see 18 candidates on the uncorrected image, matching the real run.
    const { detectSuspiciousNewText } = await import('../src/lib/floorplanMask/floorplanValidation');
    const beforeCorrection = await detectSuspiciousNewText(generated, protectedMask);
    assert.equal(beforeCorrection.newTextBlobCount, 18, `test setup sanity check: heuristic must see 18 candidates before correction (got ${beforeCorrection.newTextBlobCount})`);

    const outcome = await attemptTextCorrectionAndRevalidate(original, generated, protectedMask, confirmedBoxes, MARGIN_PX, STDDEV_THRESHOLD);

    assert.equal(outcome.decisions.length, 4);
    assert.ok(
      outcome.decisions.every((d) => d.verdict === 'restored'),
      'all 4 confirmed boxes must be restored'
    );
    assert.equal(outcome.residualBoxesExternal.length, 14, 'the 14 untouched external candidates must still be detected, but only as external');
    assert.equal(outcome.residualBoxesWithinConfirmedRegions.length, 0, 'none of the 4 corrected regions may have a residual candidate');
    assert.ok(outcome.allSafelyCorrected, 'the result must proceed: the 14 external, already-adjudicated false positives must not block it');
    assert.ok(!outcome.externalModificationDetected);

    original.delete();
    generated.delete();
    protectedMask.delete();
    outcome.correctedRgba.delete();
  });

  // --- 8) A residual mark INSIDE one of the confirmed+corrected regions must reject ---
  await test('a residual text-like mark surviving inside a confirmed+corrected region rejects (rejected_residual_overlap)', async () => {
    const w = 300, h = 300;
    // The ORIGINAL itself has a small pre-existing dark speck INSIDE where the confirmed box will be — small enough that the region's overall stdDev stays under threshold (so before/after uniformity checks both pass), but large/dark enough to still register as its own text-like blob once restored.
    const original = new cv.Mat(h, w, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    cv.rectangle(original, new cv.Point(125, 125), new cv.Point(131, 133), new cv.Scalar(0, 0, 0, 255), -1);

    const generated = new cv.Mat();
    original.copyTo(generated);
    // FLUX drew a larger hallucinated mark over the same area (covering the pre-existing speck too).
    cv.rectangle(generated, new cv.Point(110, 110), new cv.Point(150, 150), new cv.Scalar(40, 40, 40, 255), -1);

    const protectedMask = cv.Mat.zeros(h, w, cv.CV_8UC1);
    const confirmedBoxes = [{ xMin: 110, yMin: 110, xMax: 150, yMax: 150 }];

    const outcome = await attemptTextCorrectionAndRevalidate(original, generated, protectedMask, confirmedBoxes, MARGIN_PX, 40 /* generous stdDev threshold so the tiny speck alone doesn't fail the before/after uniformity check — isolates the residual-overlap mechanism specifically */);

    assert.equal(outcome.decisions[0].verdict, 'rejected_residual_overlap', `expected the pre-existing speck to survive restoration and be caught as a residual overlap (got ${outcome.decisions[0].verdict})`);
    assert.ok(!outcome.allSafelyCorrected);
    assert.ok(outcome.residualBoxesWithinConfirmedRegions.length >= 1);

    original.delete();
    generated.delete();
    protectedMask.delete();
    outcome.correctedRgba.delete();
  });

  // --- 9) A hard safety-invariant violation ("alteração fora das caixas") must be detectable and would force a rejection ---
  await test('detectExternalModification flags a change outside every touched zone, and reports clean when nothing changed there', async () => {
    const w = 200, h = 150;
    const before = new cv.Mat(h, w, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    const untouchedAfter = new cv.Mat();
    before.copyTo(untouchedAfter);
    // Only the "touched zone" changed — must read as clean.
    cv.rectangle(untouchedAfter, new cv.Point(10, 10), new cv.Point(30, 30), new cv.Scalar(0, 0, 0, 255), -1);
    const cleanResult = await detectExternalModification(before, untouchedAfter, [{ x: 5, y: 5, width: 30, height: 30 }]);
    assert.equal(cleanResult, false, 'a change strictly inside the declared touched zone must not be flagged');

    const tamperedAfter = new cv.Mat();
    before.copyTo(tamperedAfter);
    // A change FAR from any touched zone — simulates a hypothetical implementation bug leaking outside the confirmed box.
    cv.rectangle(tamperedAfter, new cv.Point(150, 100), new cv.Point(170, 120), new cv.Scalar(0, 0, 0, 255), -1);
    const tamperedResult = await detectExternalModification(before, tamperedAfter, [{ x: 5, y: 5, width: 30, height: 30 }]);
    assert.equal(tamperedResult, true, 'a change outside every touched zone must be flagged as an external modification');

    before.delete();
    untouchedAfter.delete();
    tamperedAfter.delete();
  });

  // --- 10) A confirmed box over floor/texture must reject and never be patched (re-stated explicitly per this round's requirement list — mechanism already covered above, kept here for direct traceability) ---
  await test('a confirmed box over floor/texture rejects and the correction never touches it (traceability re-check)', async () => {
    const original = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    for (let y = 190; y < 240; y++) {
      for (let x = 130; x < 270; x++) {
        const on = (Math.floor(x / 5) + Math.floor(y / 5)) % 2 === 0;
        original.ucharPtr(y, x).set(on ? [180, 140, 90, 255] : [150, 110, 70, 255]);
      }
    }
    const generated = new cv.Mat();
    original.copyTo(generated);
    cv.putText(generated, 'FAKE', new cv.Point(150, 220), cv.FONT_HERSHEY_SIMPLEX, 0.8, new cv.Scalar(0, 0, 0, 255), 2, cv.LINE_AA);
    const protectedMask = cv.Mat.zeros(height, width, cv.CV_8UC1);
    const outcome = await attemptTextCorrectionAndRevalidate(original, generated, protectedMask, [{ xMin: 145, yMin: 195, xMax: 220, yMax: 235 }], MARGIN_PX, STDDEV_THRESHOLD);
    assert.equal(outcome.decisions[0].verdict, 'rejected_relevant_region');
    assert.ok(!outcome.allSafelyCorrected);
    original.delete();
    generated.delete();
    protectedMask.delete();
    outcome.correctedRgba.delete();
  });

  // --- 11) Zero external calls: no network/provider import anywhere in this module ---
  await test('textCorrection.ts imports no network/provider module', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/lib/floorplanMask/textCorrection.ts'), 'utf8');
    const importLines = src.split('\n').filter((line) => line.trim().startsWith('import '));
    for (const line of importLines) {
      assert.ok(!/from ['"]openai['"]/.test(line), `unexpected OpenAI import: ${line}`);
      assert.ok(!/providers\//.test(line), `unexpected provider import: ${line}`);
    }
    assert.ok(!/fetch\(/.test(src));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
