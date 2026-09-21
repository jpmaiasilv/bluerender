/**
 * Local test suite for the OpenAI Vision structural/semantic validation
 * split (fix for the 2026-09-19 real-run failure: a Zod `.refine()` size
 * check on each object voided the WHOLE overview response when only a
 * handful of the returned objects had an implausible box). Runs entirely
 * offline — no OPENAI_API_KEY needed, no network call, no credits spent.
 *
 * Covers every scenario from the fix's requirement list:
 *  - a valid small object at overview scale is accepted;
 *  - a degenerate/too-small object is discarded individually;
 *  - a response mixing valid and invalid objects keeps the valid ones;
 *  - all objects invalid but a room is valid — proceeds-to-tiles gate;
 *  - nothing usable at all — proceeds-to-tiles gate stays closed;
 *  - overview vs tile use different thresholds for the identical box;
 *  - a structural (schema) failure still throws and is classified as
 *    VALIDATION_ERROR, never the generic UNKNOWN_ERROR;
 *  - no external call happens anywhere in this file.
 *
 * Run with: npx tsx scripts/test-openai-vision-filtering.ts
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  filterObjectDetections,
  filterRoomDetections,
  parseOpenAIOverviewResponse,
  parseOpenAITileResponse,
} from '../src/lib/floorplanFurniture/openaiResponseSchema';
import { getOpenAiVisionCallCount } from '../src/providers/openaiVision';
import {
  OPENAI_VISION_MIN_OBJECT_DIMENSION_PX,
  OPENAI_VISION_OVERVIEW_MIN_AREA_RATIO,
  OPENAI_VISION_TILE_MIN_AREA_RATIO,
} from '../src/config/openaiModels';
import {
  resolveVisionDiagnosticsTtlMs,
  saveVisionDetectionDiagnostics,
  sweepExpiredVisionDetectionDiagnostics,
  VISION_DIAGNOSTICS_TTL_MS,
} from '../src/storage/visionDetectionDiagnosticsStore';

let passed = 0;
let failed = 0;
const callCountAtStart = getOpenAiVisionCallCount();

async function test(name: string, fn: () => void | Promise<void>) {
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

const OPENAI_VISION_SOURCE = fs.readFileSync(path.resolve(__dirname, '../src/providers/openaiVision.ts'), 'utf8');
const DETECT_SOURCE = fs.readFileSync(path.resolve(__dirname, '../src/lib/floorplanFurniture/detectFloorplanFurnitureOpenAI.ts'), 'utf8');

function baseObject(overrides: Partial<{ id: string; category: string; confidence: number; box: { xMin: number; yMin: number; xMax: number; yMax: number } }> = {}) {
  return {
    id: overrides.id ?? 'o1',
    category: overrides.category ?? 'cadeira',
    subcategory: null,
    roomType: null,
    confidence: overrides.confidence ?? 0.9,
    orientationDegrees: null,
    box: overrides.box ?? { xMin: 0, yMin: 0, xMax: 50, yMax: 50 },
    replaceable: true,
    notes: null,
  };
}

async function main() {
  console.log('OpenAI Vision — structural/semantic validation split, local tests\n');

  // --- 1) A real-scale small object at overview scale is accepted ---
  await test('a small real fixture (33x33px) in a whole-apartment overview (1755x1241) is accepted, not discarded', () => {
    const sample = JSON.stringify({
      imageWidth: 1755,
      imageHeight: 1241,
      rooms: [],
      objects: [baseObject({ category: 'vaso_sanitario', box: { xMin: 100, yMin: 100, xMax: 133, yMax: 133 } })],
      warnings: [],
    });
    const parsed = parseOpenAIOverviewResponse(sample, 1755, 1241);
    assert.equal(parsed.objects.length, 1);
    assert.equal(parsed.discardedObjects.length, 0);
    assert.equal(parsed.objectMetrics.totalAccepted, 1);
  });

  // --- 2) A degenerate/pixel-noise object is discarded individually ---
  await test('a 1x1px object is discarded as degenerate/below the pixel floor, never thrown', () => {
    const sample = JSON.stringify({
      imageWidth: 1755,
      imageHeight: 1241,
      rooms: [],
      objects: [baseObject({ box: { xMin: 500, yMin: 500, xMax: 501, yMax: 501 } })],
      warnings: [],
    });
    const parsed = parseOpenAIOverviewResponse(sample, 1755, 1241);
    assert.equal(parsed.objects.length, 0);
    assert.equal(parsed.discardedObjects.length, 1);
    assert.equal(parsed.discardedObjects[0].reasonCode, 'below_pixel_floor');
  });

  // --- 3) Mixed valid + invalid objects: valid ones survive, invalid ones are individually reported ---
  await test('a response with both valid and invalid objects keeps the valid ones and reports the invalid ones individually', () => {
    const sample = JSON.stringify({
      imageWidth: 1755,
      imageHeight: 1241,
      rooms: [],
      objects: [
        baseObject({ id: 'good-1', category: 'cama', box: { xMin: 100, yMin: 100, xMax: 300, yMax: 250 } }),
        baseObject({ id: 'bad-1', category: 'objeto_outro', box: { xMin: 10, yMin: 10, xMax: 12, yMax: 12 } }), // below pixel floor
        baseObject({ id: 'good-2', category: 'sofa', box: { xMin: 400, yMin: 400, xMax: 500, yMax: 460 } }),
        baseObject({ id: 'bad-2', category: 'objeto_outro', box: { xMin: 1700, yMin: 1200, xMax: 1800, yMax: 1300 } }), // out of bounds — exceeds the 1755x1241 crop, but still structurally well-formed (non-negative, xMax>xMin)
      ],
      warnings: [],
    });
    const parsed = parseOpenAIOverviewResponse(sample, 1755, 1241);
    assert.equal(parsed.objects.length, 2, 'both good objects must survive');
    assert.deepEqual(
      parsed.objects.map((o) => o.id),
      ['good-1', 'good-2']
    );
    assert.equal(parsed.discardedObjects.length, 2);
    assert.equal(parsed.objectMetrics.totalReceived, 4);
    assert.equal(parsed.objectMetrics.totalAccepted, 2);
    assert.equal(parsed.objectMetrics.totalDiscarded, 2);
    assert.ok(parsed.objectMetrics.acceptedSizeStats, 'size stats must be computed from the accepted objects only');
  });

  // --- 4) Reproduces the exact real-run shape: 6 good + 10 bad objects, all reported individually, no throw ---
  await test('reproduces the real 2026-09-19 shape (16 objects, 10 implausible) without throwing and without discarding the good ones', () => {
    const goodObjects = Array.from({ length: 6 }, (_, i) => baseObject({ id: `good-${i}`, box: { xMin: 50 + i * 60, yMin: 50, xMax: 50 + i * 60 + 40, yMax: 90 } }));
    const badObjects = Array.from({ length: 10 }, (_, i) => baseObject({ id: `bad-${i}`, box: { xMin: 700 + i * 5, yMin: 700, xMax: 700 + i * 5 + 2, yMax: 702 } })); // 2x2px, below pixel floor
    const sample = JSON.stringify({ imageWidth: 1755, imageHeight: 1241, rooms: [], objects: [...goodObjects, ...badObjects], warnings: [] });
    const parsed = parseOpenAIOverviewResponse(sample, 1755, 1241);
    assert.equal(parsed.objects.length, 6, 'the 6 good detections must survive — this is the exact class of data the old code discarded entirely');
    assert.equal(parsed.discardedObjects.length, 10);
    assert.equal(parsed.objectMetrics.discardReasonsGrouped.below_pixel_floor, 10);
  });

  // --- 5) All objects invalid, but a room is valid: proceeds-to-tiles gate must still open ---
  await test('all objects discarded but a room is valid: the overview-usable check considers rooms, not just objects', () => {
    const sample = JSON.stringify({
      imageWidth: 1755,
      imageHeight: 1241,
      rooms: [{ id: 'r1', type: 'quarto', label: 'Quarto 1', confidence: 0.9, box: { xMin: 0, yMin: 0, xMax: 500, yMax: 400 } }],
      objects: [baseObject({ box: { xMin: 700, yMin: 700, xMax: 702, yMax: 702 } })],
      warnings: [],
    });
    const parsed = parseOpenAIOverviewResponse(sample, 1755, 1241);
    assert.equal(parsed.objects.length, 0);
    assert.equal(parsed.rooms.length, 1);
    // The actual proceed-to-tiles decision lives in detectFloorplanFurnitureOpenAI.ts
    // (not mockable here without a real network call) — verify the gate's
    // condition is written to consider rooms, not just objects, so this exact
    // parsed shape (0 objects, 1 room) would open the gate.
    assert.match(DETECT_SOURCE, /overviewResult\.result\.objects\.length > 0 \|\| overviewResult\.result\.rooms\.length > 0/);
  });

  // --- 6) Nothing usable at all: the gate condition would stay closed ---
  await test('zero objects and zero rooms: parse succeeds (no throw) with fully empty accepted lists', () => {
    const sample = JSON.stringify({ imageWidth: 1755, imageHeight: 1241, rooms: [], objects: [], warnings: [] });
    const parsed = parseOpenAIOverviewResponse(sample, 1755, 1241);
    assert.equal(parsed.objects.length, 0);
    assert.equal(parsed.rooms.length, 0);
  });

  await test('the tile phase is skipped when overviewOnly is set OR nothing usable was found (source-level gate check)', () => {
    assert.match(DETECT_SOURCE, /const shouldRunTiles = !options\.overviewOnly && overviewHasUsableData;/);
  });

  // --- 7) Overview vs tile use different thresholds for the IDENTICAL box ---
  await test('the identical small box is accepted at overview scale but discarded at tile scale (different, documented thresholds — never one arbitrarily-lowered global floor)', () => {
    assert.ok(OPENAI_VISION_OVERVIEW_MIN_AREA_RATIO < OPENAI_VISION_TILE_MIN_AREA_RATIO, 'overview floor must be lower than tile floor, not the same value');

    // A box sized so its ratio clears the overview floor but falls under the tile floor, in a crop shared between the two variants.
    const cropWidth = 1755,
      cropHeight = 1241;
    const cropArea = cropWidth * cropHeight;
    const targetRatio = (OPENAI_VISION_OVERVIEW_MIN_AREA_RATIO + OPENAI_VISION_TILE_MIN_AREA_RATIO) / 2;
    const side = Math.ceil(Math.sqrt(targetRatio * cropArea));
    const box = { xMin: 100, yMin: 100, xMax: 100 + Math.max(side, OPENAI_VISION_MIN_OBJECT_DIMENSION_PX + 1), yMax: 100 + Math.max(side, OPENAI_VISION_MIN_OBJECT_DIMENSION_PX + 1) };

    const overviewFilter = filterObjectDetections([baseObject({ box })], cropWidth, cropHeight, 'overview');
    const tileFilter = filterObjectDetections([baseObject({ box })], cropWidth, cropHeight, 'tile');

    assert.equal(overviewFilter.accepted.length, 1, 'must be accepted at overview scale');
    assert.equal(tileFilter.accepted.length, 0, 'must be discarded at tile scale (stricter floor)');
    assert.equal(tileFilter.discarded[0].reasonCode, 'below_area_ratio_floor');
  });

  // --- 8) Rooms never get an area-ratio floor/ceiling (a single-room studio can be ~100% of its crop) ---
  await test('filterRoomDetections never discards a room purely for being a large fraction of the crop', () => {
    const cropWidth = 500,
      cropHeight = 400;
    const hugeRoom = { id: 'r1', type: 'studio', label: null, confidence: 0.9, box: { xMin: 0, yMin: 0, xMax: 499, yMax: 399 } };
    const result = filterRoomDetections([hugeRoom], cropWidth, cropHeight);
    assert.equal(result.accepted.length, 1);
  });

  // --- 9) Structural (schema) failures still throw, and providers/openaiVision.ts classifies them as VALIDATION_ERROR (source-level check — the actual call requires a real network response to trigger from inside detectFurnitureObjectsOpenAI) ---
  await test('a genuinely malformed structural response (missing required field) still throws a plain Error at the parse layer', () => {
    const malformed = JSON.stringify({ imageWidth: 100, imageHeight: 100, rooms: [], objects: [{ id: 'o1' /* missing category, box, etc */ }], warnings: [] });
    assert.throws(() => parseOpenAIOverviewResponse(malformed, 100, 100), /schema validation/);
  });

  await test('invalid JSON still throws a plain Error at the parse layer', () => {
    assert.throws(() => parseOpenAIOverviewResponse('{not json', 100, 100), /not valid JSON/);
  });

  await test('providers/openaiVision.ts wraps both overview and tile structural parse failures as AppError(\'VALIDATION_ERROR\', ...), never left as a generic Error', () => {
    const overviewTryBlockIndex = OPENAI_VISION_SOURCE.indexOf("if (params.variant === 'overview') {");
    const tileSectionIndex = OPENAI_VISION_SOURCE.lastIndexOf('let parsed;');
    assert.ok(overviewTryBlockIndex >= 0 && tileSectionIndex > overviewTryBlockIndex);
    const overviewSection = OPENAI_VISION_SOURCE.slice(overviewTryBlockIndex, tileSectionIndex);
    const tileSection = OPENAI_VISION_SOURCE.slice(tileSectionIndex);
    for (const [label, section] of [
      ['overview', overviewSection],
      ['tile', tileSection],
    ] as const) {
      assert.match(section, /parseOpenAI(Overview|Tile)Response/, `${label} section must call the parser`);
      assert.match(section, /catch \(err\) \{/, `${label} section must catch a parse failure`);
      assert.match(section, /'VALIDATION_ERROR'/, `${label} section must classify a parse failure as VALIDATION_ERROR`);
      assert.ok(!/UNKNOWN_ERROR/.test(section), `${label} section must never fall back to UNKNOWN_ERROR for a known parse failure`);
    }
  });

  // --- 10) Private diagnostics for the vision-detection step: TTL, never under public/, sanitized content only ---
  await test('resolveVisionDiagnosticsTtlMs rejects an out-of-range value instead of silently clamping', () => {
    assert.throws(() => resolveVisionDiagnosticsTtlMs('1'));
    assert.throws(() => resolveVisionDiagnosticsTtlMs('999999999999'));
    assert.equal(resolveVisionDiagnosticsTtlMs(undefined), VISION_DIAGNOSTICS_TTL_MS);
  });

  await test('saveVisionDetectionDiagnostics writes sanitized JSON privately (never under public/), associated by diagnosticsId and cropId, then sweeps on TTL', () => {
    const diagnosticsId = crypto.randomUUID();
    const payload = {
      variant: 'overview' as const,
      cropWidth: 1755,
      cropHeight: 1241,
      acceptedObjects: [{ id: 'o1', category: 'cama' }],
      discardedObjects: [{ index: 1, category: 'objeto_outro', reasonCode: 'below_pixel_floor' as const, reason: 'menor que o piso', widthPx: 2, heightPx: 2, areaRatio: 0.0000001 }],
      objectMetrics: { totalReceived: 2, totalAccepted: 1, totalDiscarded: 1, discardReasonsGrouped: { below_pixel_floor: 1 }, acceptedSizeStats: null },
      acceptedRooms: [],
      discardedRooms: [],
      roomMetrics: { totalReceived: 0, totalAccepted: 0, totalDiscarded: 0, discardReasonsGrouped: {}, acceptedSizeStats: null },
      requestId: 'resp_test',
      elapsedMs: 1234,
    };
    saveVisionDetectionDiagnostics(diagnosticsId, 'overview', payload);

    const dir = path.resolve(__dirname, '..', 'private-diagnostics', 'humanized-floorplan-vision-detections', diagnosticsId);
    assert.ok(fs.existsSync(path.join(dir, 'overview.json')));
    assert.ok(!dir.split(path.sep).includes('public'));
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'overview.json'), 'utf8'));
    assert.equal(saved.requestId, 'resp_test');
    const rawText = fs.readFileSync(path.join(dir, 'overview.json'), 'utf8');
    assert.ok(!/sk-[A-Za-z0-9]/.test(rawText), 'must never contain anything resembling an API key');
    assert.ok(!/data:image\//.test(rawText), 'must never contain a base64 image data URL');

    const oldTime = new Date(Date.now() - 1000);
    fs.utimesSync(dir, oldTime, oldTime);
    const removed = sweepExpiredVisionDetectionDiagnostics(Date.now(), 500);
    assert.ok(removed >= 1);
    assert.ok(!fs.existsSync(dir));
  });

  await test('saveVisionDetectionDiagnostics rejects a non-UUID diagnosticsId or a malformed cropId (defense in depth)', () => {
    assert.throws(() => saveVisionDetectionDiagnostics('../../etc', 'overview', {} as never));
    assert.throws(() => saveVisionDetectionDiagnostics(crypto.randomUUID(), '../evil', {} as never));
  });

  // --- 11) No external call anywhere in this suite ---
  await test('no OpenAI call was attempted during this entire test run', () => {
    assert.equal(getOpenAiVisionCallCount(), callCountAtStart);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
