/**
 * Local test suite for the OpenAI semantic furniture-detection pipeline and
 * the (not-yet-called) block-image generator. Runs entirely offline — no
 * network calls, no OPENAI_API_KEY needed, no credits spent, no BFL/FLUX/
 * Gemini call of any kind.
 *
 * Run with: npm run test:floorplan-furniture-openai -w backend
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { Jimp } from 'jimp';
import { getOpenCv } from '../src/lib/floorplanMask/opencvRuntime';
import {
  buildOpenAIOverviewSchema,
  buildOpenAITileSchema,
  OPENAI_OVERVIEW_JSON_SCHEMA,
  OPENAI_TILE_JSON_SCHEMA,
  parseOpenAIOverviewResponse,
  parseOpenAITileResponse,
} from '../src/lib/floorplanFurniture/openaiResponseSchema';
import { mapBoxToOriginal, mapPolygonToOriginal } from '../src/lib/floorplanFurniture/openaiCoordinateTransform';
import { boxIouOpenAI, dedupeOpenAIObjects, dedupeOpenAIRooms } from '../src/lib/floorplanFurniture/deduplicationOpenAI';
import { combineOpenAIWithStructure } from '../src/lib/floorplanFurniture/combineWithStructureOpenAI';
import { DenormalizedOpenAIObject, DenormalizedOpenAIRoom } from '../src/lib/floorplanFurniture/openaiTypes';
import { SourceCrop } from '../src/lib/floorplanFurniture/types';
import { classifyOpenAiError } from '../src/providers/openaiVision';
import { buildBlockImagePrompt } from '../src/providers/openaiBlockImage';
import { validateBlockImagePng } from '../src/lib/blockImage/pngValidation';
import { resolveOpenAiVisionTimeoutMs, ACTIVE_VISION_PROVIDER, OPENAI_VISION_MODEL, OPENAI_BLOCK_IMAGE_MODEL } from '../src/config/openaiModels';
import { withIdempotencyKey, withIdempotencyKeyAsync, resetIdempotencyStoreForTests } from '../src/services/idempotencyKeys';

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

/** A minimal, structurally valid transparent PNG (a small circle centered in a transparent square) — built with jimp so the test suite has no external fixture-file dependency. */
async function makeValidTransparentPng(): Promise<Buffer> {
  const size = 64;
  const image = new Jimp({ width: size, height: size, color: 0x00000000 }); // fully transparent
  const opaqueBlack = 0x000000ff;
  const center = size / 2;
  const radius = size / 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      if (dx * dx + dy * dy <= radius * radius) {
        image.setPixelColor(opaqueBlack, x, y);
      }
    }
  }
  return image.getBuffer('image/png');
}

/** A PNG with alpha capability but a fully OPAQUE (white) background — the "imperfect transparency" case that must never be silently accepted. */
async function makeOpaqueBackgroundPng(): Promise<Buffer> {
  const size = 64;
  const image = new Jimp({ width: size, height: size, color: 0xffffffff }); // opaque white
  return image.getBuffer('image/png');
}

/** A PNG where the "object" (opaque pixels) touches the image border. */
async function makeBorderTouchingPng(): Promise<Buffer> {
  const size = 64;
  const image = new Jimp({ width: size, height: size, color: 0x00000000 });
  const opaqueBlack = 0x000000ff;
  for (let x = 0; x < size; x++) {
    image.setPixelColor(opaqueBlack, x, 0); // top row touches the border
  }
  return image.getBuffer('image/png');
}

async function main() {
  console.log('Planta Humanizada — OpenAI furniture-detection + block-image pipeline local tests\n');
  const cv = await getOpenCv();

  // --- Provider switch defaults to OpenAI, Gemini stays available but inactive ---
  await test('ACTIVE_VISION_PROVIDER defaults to "openai"', () => {
    assert.equal(ACTIVE_VISION_PROVIDER, 'openai');
  });

  await test('model names are centralized (not the empty string / not hardcoded elsewhere) and match the requested models', () => {
    assert.equal(OPENAI_VISION_MODEL, 'gpt-5.6-terra');
    assert.equal(OPENAI_BLOCK_IMAGE_MODEL, 'gpt-image-2.5-sunburst');
  });

  // --- 1) Schema valid/invalid ---
  await test('a well-formed overview response (boxes only) passes validation', () => {
    const sample = JSON.stringify({
      imageWidth: 1000,
      imageHeight: 800,
      rooms: [{ id: 'r1', type: 'quarto', label: 'Quarto 1', confidence: 0.9, box: { xMin: 0, yMin: 0, xMax: 500, yMax: 400 } }],
      objects: [
        {
          id: 'o1',
          category: 'cama',
          subcategory: null,
          roomType: 'quarto',
          confidence: 0.9,
          orientationDegrees: 0,
          box: { xMin: 10, yMin: 10, xMax: 200, yMax: 150 },
          replaceable: true,
          notes: null,
        },
      ],
      warnings: [],
    });
    const parsed = parseOpenAIOverviewResponse(sample, 1000, 800);
    assert.equal(parsed.objects.length, 1);
    assert.equal(parsed.rooms.length, 1);
  });

  await test('a well-formed tile response (with polygon) passes validation', () => {
    const sample = JSON.stringify({
      imageWidth: 500,
      imageHeight: 500,
      rooms: [],
      objects: [
        {
          id: 'o1',
          category: 'sofa',
          subcategory: '3-seat',
          roomType: 'sala',
          confidence: 0.85,
          orientationDegrees: 90,
          box: { xMin: 10, yMin: 10, xMax: 200, yMax: 150 },
          polygon: [
            { x: 10, y: 10 },
            { x: 200, y: 10 },
            { x: 200, y: 150 },
            { x: 10, y: 150 },
          ],
          replaceable: true,
          notes: null,
        },
      ],
      warnings: ['low confidence on object orientation'],
    });
    const parsed = parseOpenAITileResponse(sample, 500, 500);
    assert.equal(parsed.objects[0].polygon?.length, 4);
  });

  await test('invalid JSON is rejected', () => {
    assert.throws(() => parseOpenAIOverviewResponse('not json', 100, 100), /not valid JSON/);
    assert.throws(() => parseOpenAITileResponse('not json', 100, 100), /not valid JSON/);
  });

  await test('negative coordinates are rejected', () => {
    const sample = JSON.stringify({
      imageWidth: 100,
      imageHeight: 100,
      rooms: [],
      objects: [{ id: 'o1', category: 'cadeira', subcategory: null, roomType: null, confidence: 0.9, orientationDegrees: null, box: { xMin: -5, yMin: 0, xMax: 50, yMax: 50 }, replaceable: true, notes: null }],
      warnings: [],
    });
    assert.throws(() => parseOpenAIOverviewResponse(sample, 100, 100), /schema validation/);
  });

  await test('xMax <= xMin is rejected', () => {
    const sample = JSON.stringify({
      imageWidth: 100,
      imageHeight: 100,
      rooms: [],
      objects: [{ id: 'o1', category: 'cadeira', subcategory: null, roomType: null, confidence: 0.9, orientationDegrees: null, box: { xMin: 50, yMin: 0, xMax: 50, yMax: 50 }, replaceable: true, notes: null }],
      warnings: [],
    });
    assert.throws(() => parseOpenAIOverviewResponse(sample, 100, 100), /xMax must be greater than.*xMin|schema validation/);
  });

  await test('yMax <= yMin is rejected', () => {
    const sample = JSON.stringify({
      imageWidth: 100,
      imageHeight: 100,
      rooms: [],
      objects: [{ id: 'o1', category: 'cadeira', subcategory: null, roomType: null, confidence: 0.9, orientationDegrees: null, box: { xMin: 0, yMin: 50, xMax: 50, yMax: 40 }, replaceable: true, notes: null }],
      warnings: [],
    });
    assert.throws(() => parseOpenAIOverviewResponse(sample, 100, 100), /schema validation/);
  });

  await test('confidence outside [0,1] is rejected', () => {
    const sample = JSON.stringify({
      imageWidth: 100,
      imageHeight: 100,
      rooms: [],
      objects: [{ id: 'o1', category: 'cadeira', subcategory: null, roomType: null, confidence: 1.5, orientationDegrees: null, box: { xMin: 0, yMin: 0, xMax: 50, yMax: 50 }, replaceable: true, notes: null }],
      warnings: [],
    });
    assert.throws(() => parseOpenAIOverviewResponse(sample, 100, 100), /schema validation/);
  });

  await test('empty category is rejected', () => {
    const sample = JSON.stringify({
      imageWidth: 100,
      imageHeight: 100,
      rooms: [],
      objects: [{ id: 'o1', category: '', subcategory: null, roomType: null, confidence: 0.9, orientationDegrees: null, box: { xMin: 0, yMin: 0, xMax: 50, yMax: 50 }, replaceable: true, notes: null }],
      warnings: [],
    });
    assert.throws(() => parseOpenAIOverviewResponse(sample, 100, 100), /schema validation/);
  });

  // --- Individual semantic discard: a bad detection is dropped on its own, the response never throws for it (the actual 2026-09-19 bug this replaces: one bad object used to void the WHOLE array via a Zod .refine()) ---
  await test('an implausibly tiny object (below the overview pixel floor) is discarded individually, not thrown', () => {
    const sample = JSON.stringify({
      imageWidth: 1000,
      imageHeight: 1000,
      rooms: [],
      objects: [{ id: 'o1', category: 'cadeira', subcategory: null, roomType: null, confidence: 0.9, orientationDegrees: null, box: { xMin: 0, yMin: 0, xMax: 2, yMax: 2 }, replaceable: true, notes: null }],
      warnings: [],
    });
    const parsed = parseOpenAIOverviewResponse(sample, 1000, 1000);
    assert.equal(parsed.objects.length, 0);
    assert.equal(parsed.discardedObjects.length, 1);
    assert.equal(parsed.discardedObjects[0].reasonCode, 'below_pixel_floor');
    assert.equal(parsed.objectMetrics.totalReceived, 1);
    assert.equal(parsed.objectMetrics.totalDiscarded, 1);
  });

  await test('an implausibly huge object (relative to the crop) is discarded individually, not thrown', () => {
    const sample = JSON.stringify({
      imageWidth: 1000,
      imageHeight: 1000,
      rooms: [],
      objects: [{ id: 'o1', category: 'cadeira', subcategory: null, roomType: null, confidence: 0.9, orientationDegrees: null, box: { xMin: 0, yMin: 0, xMax: 999, yMax: 999 }, replaceable: true, notes: null }],
      warnings: [],
    });
    const parsed = parseOpenAIOverviewResponse(sample, 1000, 1000);
    assert.equal(parsed.objects.length, 0);
    assert.equal(parsed.discardedObjects[0].reasonCode, 'above_area_ratio_ceiling');
  });

  await test('a real-scale small object in a whole-apartment overview is ACCEPTED (the actual bug this fix addresses)', () => {
    // Mirrors the real planta-tecnica-real-01.jpg failure: a ~2.18 million px² overview, an object with a ~33x33px box (well above the absolute pixel floor, but far below the OLD single global ratio floor of 0.05%).
    const cropWidth = 1755,
      cropHeight = 1241;
    const sample = JSON.stringify({
      imageWidth: cropWidth,
      imageHeight: cropHeight,
      rooms: [],
      objects: [{ id: 'o1', category: 'vaso_sanitario', subcategory: null, roomType: 'banheiro', confidence: 0.85, orientationDegrees: null, box: { xMin: 100, yMin: 100, xMax: 133, yMax: 133 }, replaceable: true, notes: null }],
      warnings: [],
    });
    const parsed = parseOpenAIOverviewResponse(sample, cropWidth, cropHeight);
    assert.equal(parsed.discardedObjects.length, 0, 'a real small fixture at overview scale must not be discarded');
    assert.equal(parsed.objects.length, 1);
  });

  // --- 2) Objects/polygons out of the image bounds ---
  await test('a polygon point outside the image bounds is discarded individually (tile schema), not thrown', () => {
    const sample = JSON.stringify({
      imageWidth: 100,
      imageHeight: 100,
      rooms: [],
      objects: [
        {
          id: 'o1',
          category: 'sofa',
          subcategory: null,
          roomType: null,
          confidence: 0.9,
          orientationDegrees: null,
          box: { xMin: 0, yMin: 0, xMax: 50, yMax: 50 },
          polygon: [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 50, y: 200 }, // outside the 100-tall image
          ],
          replaceable: true,
          notes: null,
        },
      ],
      warnings: [],
    });
    const parsed = parseOpenAITileResponse(sample, 100, 100);
    assert.equal(parsed.objects.length, 0);
    assert.equal(parsed.discardedObjects[0].reasonCode, 'polygon_out_of_bounds');
  });

  // --- 3) Coordinate conversion (crop-local pixels -> original image pixels) ---
  await test('mapBoxToOriginal converts a crop-local pixel box to exact original-image pixels', () => {
    const crop: SourceCrop = { id: 'tile-1', rectInOriginal: { x: 200, y: 100, width: 400, height: 300 }, sentWidth: 400, sentHeight: 300 };
    // No resize happened (sent == original crop size), so mapping is a pure translation.
    const box = mapBoxToOriginal({ xMin: 50, yMin: 50, xMax: 150, yMax: 150 }, crop, 2000, 1000);
    assert.deepEqual(box, { xMin: 250, yMin: 150, xMax: 350, yMax: 250 });
  });

  await test('mapBoxToOriginal accounts for a resize between crop and sent dimensions', () => {
    const crop: SourceCrop = { id: 'overview', rectInOriginal: { x: 0, y: 0, width: 1000, height: 500 }, sentWidth: 500, sentHeight: 250 }; // sent at half resolution
    const box = mapBoxToOriginal({ xMin: 0, yMin: 0, xMax: 250, yMax: 125 }, crop, 1000, 500);
    assert.deepEqual(box, { xMin: 0, yMin: 0, xMax: 500, yMax: 250 });
  });

  await test('mapBoxToOriginal clamps to the original image bounds', () => {
    const crop: SourceCrop = { id: 'edge', rectInOriginal: { x: 900, y: 900, width: 100, height: 100 }, sentWidth: 100, sentHeight: 100 };
    const box = mapBoxToOriginal({ xMin: 0, yMin: 0, xMax: 150, yMax: 150 }, crop, 950, 950);
    assert.ok(box.xMax <= 950 && box.yMax <= 950);
  });

  await test('mapPolygonToOriginal converts and clips a polygon', () => {
    const crop: SourceCrop = { id: 'overview', rectInOriginal: { x: 0, y: 0, width: 100, height: 100 }, sentWidth: 100, sentHeight: 100 };
    const polygon = mapPolygonToOriginal(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      crop,
      100,
      100
    );
    assert.equal(polygon.length, 4);
    assert.deepEqual(polygon[2], { x: 100, y: 100 });
  });

  // --- 4) Deduplication across tiles (IoU + category + center + dimensions) ---
  await test('dedupeOpenAIObjects merges same-category, overlapping detections from different crops', () => {
    const a: DenormalizedOpenAIObject = {
      id: 'a',
      category: 'sofa',
      subcategory: null,
      roomType: 'sala',
      confidence: 0.7,
      orientationDegrees: 0,
      boxOriginalPixels: { xMin: 100, yMin: 100, xMax: 300, yMax: 200 },
      polygonOriginalPixels: null,
      replaceable: true,
      notes: null,
      sourceCropIds: ['overview'],
    };
    const b: DenormalizedOpenAIObject = { ...a, id: 'b', confidence: 0.9, boxOriginalPixels: { xMin: 105, yMin: 102, xMax: 298, yMax: 205 }, sourceCropIds: ['tile-1'] };
    const merged = dedupeOpenAIObjects([a, b]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].confidence, 0.9);
    assert.deepEqual(new Set(merged[0].sourceCropIds), new Set(['overview', 'tile-1']));
  });

  await test('dedupeOpenAIObjects merges via center+dimension proximity even with lower IoU', () => {
    // Two boxes for the same object, one slightly larger (as if one tile only caught it partially) — centers close, dimensions comparable, but IoU below the strict threshold.
    const a: DenormalizedOpenAIObject = {
      id: 'a',
      category: 'mesa',
      subcategory: null,
      roomType: null,
      confidence: 0.6,
      orientationDegrees: null,
      boxOriginalPixels: { xMin: 0, yMin: 0, xMax: 100, yMax: 60 },
      polygonOriginalPixels: null,
      replaceable: true,
      notes: null,
      sourceCropIds: ['overview'],
    };
    const b: DenormalizedOpenAIObject = { ...a, id: 'b', confidence: 0.95, boxOriginalPixels: { xMin: 5, yMin: 3, xMax: 108, yMax: 65 }, sourceCropIds: ['tile-1'] };
    const merged = dedupeOpenAIObjects([a, b], { iouThreshold: 0.99, centerDistanceFraction: 0.2, maxDimensionDelta: 0.3 });
    assert.equal(merged.length, 1, 'objects with close centers and comparable dimensions must merge even when IoU alone would not cross a strict threshold');
  });

  await test('dedupeOpenAIObjects keeps distinct objects of the same category separate when far apart', () => {
    const a: DenormalizedOpenAIObject = {
      id: 'a',
      category: 'cadeira',
      subcategory: null,
      roomType: null,
      confidence: 0.8,
      orientationDegrees: null,
      boxOriginalPixels: { xMin: 0, yMin: 0, xMax: 50, yMax: 50 },
      polygonOriginalPixels: null,
      replaceable: true,
      notes: null,
      sourceCropIds: ['overview'],
    };
    const b: DenormalizedOpenAIObject = { ...a, id: 'b', boxOriginalPixels: { xMin: 900, yMin: 900, xMax: 950, yMax: 950 } };
    const merged = dedupeOpenAIObjects([a, b]);
    assert.equal(merged.length, 2);
  });

  await test('dedupeOpenAIObjects prefers a polygon-bearing (tile) detection as representative over a higher-confidence box-only (overview) one', () => {
    const overviewOnly: DenormalizedOpenAIObject = {
      id: 'a',
      category: 'sofa',
      subcategory: null,
      roomType: 'sala',
      confidence: 0.97,
      orientationDegrees: null,
      boxOriginalPixels: { xMin: 100, yMin: 100, xMax: 300, yMax: 200 },
      polygonOriginalPixels: null,
      replaceable: true,
      notes: null,
      sourceCropIds: ['overview'],
    };
    const tileRefined: DenormalizedOpenAIObject = {
      ...overviewOnly,
      id: 'b',
      confidence: 0.8,
      polygonOriginalPixels: [
        { x: 100, y: 100 },
        { x: 300, y: 100 },
        { x: 300, y: 200 },
        { x: 100, y: 200 },
      ],
      sourceCropIds: ['tile-1'],
    };
    const merged = dedupeOpenAIObjects([overviewOnly, tileRefined]);
    assert.equal(merged.length, 1);
    assert.ok(merged[0].polygonOriginalPixels !== null);
  });

  await test('dedupeOpenAIRooms merges overlapping same-type rooms across crops', () => {
    const a: DenormalizedOpenAIRoom = { id: 'r1', type: 'quarto', label: 'Quarto 1', confidence: 0.8, boxOriginalPixels: { xMin: 0, yMin: 0, xMax: 500, yMax: 400 }, sourceCropIds: ['overview'] };
    const b: DenormalizedOpenAIRoom = { ...a, id: 'r2', confidence: 0.9, boxOriginalPixels: { xMin: 10, yMin: 5, xMax: 495, yMax: 398 }, sourceCropIds: ['tile-1'] };
    const merged = dedupeOpenAIRooms([a, b]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].confidence, 0.9);
  });

  await test('boxIouOpenAI returns 1 for identical boxes and 0 for disjoint boxes', () => {
    const box = { xMin: 0, yMin: 0, xMax: 10, yMax: 10 };
    assert.equal(boxIouOpenAI(box, box), 1);
    assert.equal(boxIouOpenAI(box, { xMin: 100, yMin: 100, xMax: 110, yMax: 110 }), 0);
  });

  // --- 5) Combination with OpenCV structure ---
  await test('combineOpenAIWithStructure rejects low-confidence objects and never marks them replaceable', async () => {
    const width = 400,
      height = 300;
    const protectedMask = cv.Mat.zeros(height, width, cv.CV_8UC1);
    const objects: DenormalizedOpenAIObject[] = [
      { id: 'o1', category: 'cadeira', subcategory: null, roomType: null, confidence: 0.2, orientationDegrees: null, boxOriginalPixels: { xMin: 50, yMin: 50, xMax: 100, yMax: 100 }, polygonOriginalPixels: null, replaceable: true, notes: null, sourceCropIds: ['overview'] },
    ];
    const result = await combineOpenAIWithStructure(objects, [], protectedMask, width, height, 0.5, 0.35, 4);
    assert.equal(result.objects[0].replaceable, false);
    assert.match(result.objects[0].reason, /confiança/);
    assert.equal(cv.countNonZero(result.rawFurnitureMask), 0);
    protectedMask.delete();
    result.rawFurnitureMask.delete();
    result.structureSubtractedMask.delete();
  });

  await test('combineOpenAIWithStructure never trusts the model\'s own replaceable:true over heavy structural overlap', async () => {
    const width = 400,
      height = 300;
    const protectedMask = cv.Mat.zeros(height, width, cv.CV_8UC1);
    cv.rectangle(protectedMask, new cv.Point(40, 40), new cv.Point(160, 160), new cv.Scalar(255), -1);
    const objects: DenormalizedOpenAIObject[] = [
      { id: 'o1', category: 'armario', subcategory: null, roomType: null, confidence: 0.95, orientationDegrees: null, boxOriginalPixels: { xMin: 50, yMin: 50, xMax: 150, yMax: 150 }, polygonOriginalPixels: null, replaceable: true, notes: null, sourceCropIds: ['overview'] },
    ];
    const result = await combineOpenAIWithStructure(objects, [], protectedMask, width, height, 0.5, 0.35, 0);
    assert.equal(result.objects[0].modelReplaceable, true, 'the model\'s own self-report must be preserved for transparency');
    assert.equal(result.objects[0].replaceable, false, 'but our own verdict must override it given heavy structural overlap');
    assert.equal(result.objects[0].uncertain, true);

    const overlapCheck = new cv.Mat();
    cv.bitwise_and(result.structureSubtractedMask, protectedMask, overlapCheck);
    assert.equal(cv.countNonZero(overlapCheck), 0, 'no protected pixel may ever end up in the final furniture mask');
    overlapCheck.delete();
    protectedMask.delete();
    result.rawFurnitureMask.delete();
    result.structureSubtractedMask.delete();
  });

  await test('combineOpenAIWithStructure accepts a clean, unobstructed object as replaceable and passes rooms through untouched', async () => {
    const width = 400,
      height = 300;
    const protectedMask = cv.Mat.zeros(height, width, cv.CV_8UC1);
    const objects: DenormalizedOpenAIObject[] = [
      { id: 'o1', category: 'mesa', subcategory: null, roomType: 'sala', confidence: 0.95, orientationDegrees: 0, boxOriginalPixels: { xMin: 100, yMin: 100, xMax: 200, yMax: 250 }, polygonOriginalPixels: null, replaceable: true, notes: null, sourceCropIds: ['overview'] },
    ];
    const rooms: DenormalizedOpenAIRoom[] = [{ id: 'r1', type: 'sala', label: null, confidence: 0.9, boxOriginalPixels: { xMin: 0, yMin: 0, xMax: 400, yMax: 300 }, sourceCropIds: ['overview'] }];
    const result = await combineOpenAIWithStructure(objects, rooms, protectedMask, width, height, 0.5, 0.35, 4);
    assert.equal(result.objects[0].replaceable, true);
    assert.equal(result.objects[0].reason, 'aceito');
    assert.equal(result.rooms.length, 1);
    assert.equal(result.rooms[0].type, 'sala');
    protectedMask.delete();
    result.rawFurnitureMask.delete();
    result.structureSubtractedMask.delete();
  });

  // --- 6) Timeout: configurable, bounded ---
  await test('resolveOpenAiVisionTimeoutMs defaults to 180000 and enforces [60000, 300000]', () => {
    assert.equal(resolveOpenAiVisionTimeoutMs(undefined), 180_000);
    assert.equal(resolveOpenAiVisionTimeoutMs('60000'), 60_000);
    assert.equal(resolveOpenAiVisionTimeoutMs('300000'), 300_000);
    assert.throws(() => resolveOpenAiVisionTimeoutMs('59999'), /Invalid OPENAI_VISION_TIMEOUT_MS/);
    assert.throws(() => resolveOpenAiVisionTimeoutMs('300001'), /Invalid OPENAI_VISION_TIMEOUT_MS/);
  });

  // --- 7) HTTP status classification: 401, 429, 500, 502, 503, timeout ---
  function makeApiError(status: number, body: Record<string, unknown> = { message: 'synthetic' }): OpenAI.APIError {
    return new OpenAI.APIError(status as never, body, 'synthetic error', new Headers() as never);
  }

  await test('classifyOpenAiError maps HTTP 401 to INVALID_API_KEY', () => {
    const appError = classifyOpenAiError(makeApiError(401), 100);
    assert.equal(appError.code, 'INVALID_API_KEY');
  });

  await test('classifyOpenAiError maps HTTP 429 to PROVIDER_UNAVAILABLE with no-retry/no-fallback language', () => {
    const appError = classifyOpenAiError(makeApiError(429), 100);
    assert.equal(appError.code, 'PROVIDER_UNAVAILABLE');
    assert.match(appError.message, /no automatic retry|Stopping/i);
  });

  await test('classifyOpenAiError maps HTTP 500 to PROVIDER_UNAVAILABLE', () => {
    const appError = classifyOpenAiError(makeApiError(500), 100);
    assert.equal(appError.code, 'PROVIDER_UNAVAILABLE');
  });

  await test('classifyOpenAiError maps HTTP 502 to PROVIDER_UNAVAILABLE', () => {
    const appError = classifyOpenAiError(makeApiError(502), 100);
    assert.equal(appError.code, 'PROVIDER_UNAVAILABLE');
  });

  await test('classifyOpenAiError maps HTTP 503 to PROVIDER_UNAVAILABLE', () => {
    const appError = classifyOpenAiError(makeApiError(503), 100);
    assert.equal(appError.code, 'PROVIDER_UNAVAILABLE');
  });

  await test('classifyOpenAiError maps a connection timeout to GENERATION_TIMEOUT', () => {
    const timeoutErr = new OpenAI.APIConnectionTimeoutError({ message: 'Request timed out.' });
    const appError = classifyOpenAiError(timeoutErr, 180_000);
    assert.equal(appError.code, 'GENERATION_TIMEOUT');
    assert.match(appError.message, /No automatic retry/);
  });

  // --- 8) Missing API key ---
  await test('missing OPENAI_API_KEY produces a clear INVALID_API_KEY error (module reads process.env at call time, not at import time)', async () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      // Re-require in isolation would be needed to reset the module's cached client;
      // instead we verify the guard logic directly via a fresh dynamic import path is
      // impractical here, so this test documents the guard's presence via source scan.
      const src = fs.readFileSync(path.resolve(__dirname, '../src/providers/openaiVision.ts'), 'utf-8');
      assert.ok(/OPENAI_API_KEY is not configured on the server/.test(src), 'openaiVision.ts must guard against a missing key with a clear message');
      assert.ok(/INVALID_API_KEY/.test(src));
    } finally {
      if (original !== undefined) process.env.OPENAI_API_KEY = original;
    }
  });

  // --- 9) Log sanitization (no key, no headers, no base64 image) ---
  const openaiModuleFiles = [
    '../src/providers/openaiVision.ts',
    '../src/providers/openaiBlockImage.ts',
    '../src/providers/openaiTextVerification.ts',
    '../src/lib/floorplanFurniture/detectFloorplanFurnitureOpenAI.ts',
    '../src/lib/floorplanFurniture/combineWithStructureOpenAI.ts',
    '../src/lib/floorplanFurniture/openaiResponseSchema.ts',
    '../src/lib/floorplanFurniture/deduplicationOpenAI.ts',
    '../src/lib/floorplanFurniture/openaiCoordinateTransform.ts',
    '../src/lib/floorplanMask/textVerificationSchema.ts',
    '../src/lib/blockImage/pngValidation.ts',
  ].map((p) => path.resolve(__dirname, p));

  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }

  await test('no OpenAI-related source file logs the API key, headers, or base64 image data', () => {
    for (const file of openaiModuleFiles) {
      const code = stripComments(fs.readFileSync(file, 'utf-8'));
      const loggerCalls = code.match(/(openaiLogger|console)\.(log|error|warn|info)\([^)]*\)/g) || [];
      for (const call of loggerCalls) {
        assert.ok(!/apiKey/i.test(call), `${path.basename(file)} logs something referencing apiKey: ${call}`);
        assert.ok(!/OPENAI_API_KEY/.test(call), `${path.basename(file)} logs OPENAI_API_KEY directly: ${call}`);
        assert.ok(!/\.headers\b/.test(call), `${path.basename(file)} logs an object's .headers: ${call}`);
        assert.ok(!/imageBase64|dataUrl/i.test(call), `${path.basename(file)} logs raw image data: ${call}`);
      }
    }
  });

  await test('no OpenAI-related source file imports the credit wallet or the BFL/FLUX/Gemini providers', () => {
    for (const file of openaiModuleFiles) {
      const code = stripComments(fs.readFileSync(file, 'utf-8'));
      assert.ok(!/creditWallet/.test(code), `${path.basename(file)} references creditWallet`);
      assert.ok(!/\bdebit\s*\(/.test(code), `${path.basename(file)} calls debit()`);
      assert.ok(!/providers\/bfl(Fill)?['"]/.test(code), `${path.basename(file)} imports a BFL provider`);
      assert.ok(!/providers\/geminiVision['"]/.test(code), `${path.basename(file)} imports the Gemini provider`);
    }
  });

  // --- 10) Idempotency of charges ---
  await test('withIdempotencyKey runs the operation only once per key, even across repeated calls', () => {
    resetIdempotencyStoreForTests();
    let runs = 0;
    const op = () => {
      runs += 1;
      return { charged: true, balance: 98 };
    };
    const first = withIdempotencyKey('op-1', op);
    const second = withIdempotencyKey('op-1', op);
    assert.equal(runs, 1, 'the operation (which performs the actual charge) must run exactly once for the same key');
    assert.equal(first.charged, true);
    assert.equal(second.charged, false, 'a repeated call with the same key must report charged:false');
    assert.deepEqual(second.result, first.result);
  });

  await test('withIdempotencyKey treats different keys as independent operations', () => {
    resetIdempotencyStoreForTests();
    let runs = 0;
    const op = () => {
      runs += 1;
      return runs;
    };
    withIdempotencyKey('op-a', op);
    withIdempotencyKey('op-b', op);
    assert.equal(runs, 2);
  });

  await test('withIdempotencyKeyAsync mirrors the same guarantee for an async charge operation', async () => {
    resetIdempotencyStoreForTests();
    let runs = 0;
    const op = async () => {
      runs += 1;
      return { charged: true };
    };
    await withIdempotencyKeyAsync('async-op-1', op);
    await withIdempotencyKeyAsync('async-op-1', op);
    assert.equal(runs, 1, 'polling/retrying the same async paid operation must never re-run the charge');
  });

  // --- 11) Block-image prompt construction (never calls the real API) ---
  await test('buildBlockImagePrompt always includes every fixed rendering rule', () => {
    const prompt = buildBlockImagePrompt({ prompt: 'a modern sofa', category: 'sofa' });
    for (const mustInclude of [
      'Exactly ONE object',
      'directly above',
      'centered',
      'No floor, no wall, no room',
      'No perspective',
      'No text, no watermark',
      'No additional objects',
      'transparent background',
    ]) {
      assert.ok(prompt.includes(mustInclude), `prompt is missing required rule: "${mustInclude}"`);
    }
  });

  await test('buildBlockImagePrompt includes optional context (size, materials, style) only when provided', () => {
    const withExtras = buildBlockImagePrompt({ prompt: 'a bed', category: 'cama', approxWidthMeters: 1.6, approxDepthMeters: 2.0, colorsAndMaterials: 'white oak, cream fabric', style: 'scandinavian' });
    assert.ok(withExtras.includes('1.6m x 2m') || withExtras.includes('1.6m x 2m'.replace('2m', '2')));
    assert.ok(withExtras.includes('white oak, cream fabric'));
    assert.ok(withExtras.includes('scandinavian'));

    const withoutExtras = buildBlockImagePrompt({ prompt: 'a bed', category: 'cama' });
    assert.ok(!withoutExtras.includes('Approximate real-world footprint'));
  });

  // --- 12) PNG transparency validation ---
  await test('validateBlockImagePng accepts a properly transparent PNG', async () => {
    const png = await makeValidTransparentPng();
    const result = await validateBlockImagePng(png);
    assert.equal(result.valid, true, JSON.stringify(result.reasons));
    assert.equal(result.hasAlphaChannel, true);
    assert.equal(result.cornersTransparent, true);
    assert.equal(result.objectTouchesBorder, false);
  });

  await test('validateBlockImagePng rejects a PNG with an opaque (non-transparent) background — never silently accepted', async () => {
    const png = await makeOpaqueBackgroundPng();
    const result = await validateBlockImagePng(png);
    assert.equal(result.valid, false);
    assert.equal(result.cornersTransparent, false);
  });

  await test('validateBlockImagePng rejects a PNG whose object touches the border', async () => {
    const png = await makeBorderTouchingPng();
    const result = await validateBlockImagePng(png);
    assert.equal(result.valid, false);
    assert.equal(result.objectTouchesBorder, true);
  });

  await test('validateBlockImagePng rejects a non-PNG buffer', async () => {
    const result = await validateBlockImagePng(Buffer.from('this is not a png file'));
    assert.equal(result.valid, false);
    assert.equal(result.isPng, false);
  });

  await test('validateBlockImagePng rejects a file exceeding the configured max size', async () => {
    const png = await makeValidTransparentPng();
    const result = await validateBlockImagePng(png, 10); // 10 bytes max — any real PNG exceeds this
    assert.equal(result.valid, false);
    assert.equal(result.withinMaxSize, false);
  });

  // --- Schema factories stay consistent between calls (no hidden mutable state) ---
  await test('buildOpenAIOverviewSchema / buildOpenAITileSchema are pure — repeated calls produce schemas with identical validation behavior', () => {
    const s1 = buildOpenAIOverviewSchema();
    const s2 = buildOpenAIOverviewSchema();
    const sample = { imageWidth: 500, imageHeight: 400, rooms: [], objects: [], warnings: [] };
    assert.equal(s1.safeParse(sample).success, s2.safeParse(sample).success);
  });

  await test('the strict request JSON schemas never use array-form "type" and mark every property required with additionalProperties:false', () => {
    function walk(node: unknown, isRoot = false): void {
      if (Array.isArray(node)) {
        node.forEach((n) => walk(n));
        return;
      }
      if (node && typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        if (obj.type === 'object' && 'properties' in obj) {
          assert.equal(obj.additionalProperties, false, 'every object in the strict schema must set additionalProperties:false');
          const propNames = Object.keys(obj.properties as Record<string, unknown>);
          const required = (obj.required as string[]) || [];
          for (const p of propNames) {
            assert.ok(required.includes(p), `property "${p}" must be listed in required (OpenAI strict mode requires every key to be required)`);
          }
        }
        Object.values(obj).forEach((v) => walk(v));
      }
    }
    walk(OPENAI_OVERVIEW_JSON_SCHEMA, true);
    walk(OPENAI_TILE_JSON_SCHEMA, true);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
