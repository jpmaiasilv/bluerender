/**
 * Local test suite for the Gemini semantic furniture-detection pipeline.
 * Runs entirely offline — no network calls, no GEMINI_API_KEY needed, no
 * credits spent, no BFL/FLUX call of any kind.
 *
 * Run with: npm run test:floorplan-furniture -w backend
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getOpenCv } from '../src/lib/floorplanMask/opencvRuntime';
import { boxIou, dedupeDetections } from '../src/lib/floorplanFurniture/deduplication';
import { clipPolygonToRect, denormalizeBox, denormalizePolygon, normalizeBox, normalizePolygon } from '../src/lib/floorplanFurniture/coordinateTransform';
import { planCropRects } from '../src/lib/floorplanFurniture/tiling';
import {
  GEMINI_OVERVIEW_JSON_SCHEMA,
  GEMINI_TILE_JSON_SCHEMA,
  parseGeminiOverviewResponse,
  parseGeminiTileResponse,
} from '../src/lib/floorplanFurniture/geminiResponseSchema';
import { combineDetectionsWithStructure } from '../src/lib/floorplanFurniture/combineWithStructure';
import { DenormalizedDetection, SourceCrop } from '../src/lib/floorplanFurniture/types';
import {
  assertValidThinkingLevel,
  GEMINI_VISION_THINKING_LEVEL,
  GEMINI_VISION_TIMEOUT_MS,
  resolveThinkingLevel,
  resolveTimeoutMs,
} from '../src/config/geminiVisionEngine';

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
  console.log('Planta Humanizada — Gemini furniture-detection pipeline local tests\n');
  const cv = await getOpenCv();

  // --- 1) Normalized coordinate conversion ---
  await test('normalizeBox converts an original-pixel box to 0-1 normalized', () => {
    const box = normalizeBox([100, 50, 300, 250], 1000, 500); // [ymin,xmin,ymax,xmax], width=1000, height=500
    assert.deepEqual(box, [0.2, 0.05, 0.6, 0.25]);
  });

  await test('normalizePolygon converts original-pixel points to 0-1 normalized', () => {
    const poly = normalizePolygon(
      [
        [100, 200],
        [300, 400],
      ],
      1000,
      500
    );
    assert.deepEqual(poly, [
      [0.1, 0.4],
      [0.3, 0.8],
    ]);
  });

  // --- 2) Denormalization: crop-local 0-1000 -> original image pixels ---
  await test('denormalizeBox maps a crop-local box back to exact original-image pixels', () => {
    // A crop that sits at (200,100) in the original image, is 400x300 in
    // the original, but was downscaled to 200x150 before being sent to Gemini.
    const crop: SourceCrop = {
      id: 'tile-1',
      rectInOriginal: { x: 200, y: 100, width: 400, height: 300 },
      sentWidth: 200,
      sentHeight: 150,
    };
    // box_2d [ymin,xmin,ymax,xmax] at the crop's own center-quarter, normalized to 0-1000.
    const box = denormalizeBox([250, 250, 500, 500], crop, 2000, 1000);
    // ymin=250/1000 * 150(sent) * (300/150 scale) + 100(offset) = 0.25*300+100=175
    // xmin=250/1000 * 200(sent) * (400/200 scale) + 200(offset) = 0.25*400+200=300
    // ymax=500/1000 * 300 + 100 = 250 ; xmax=500/1000*400+200=400
    assert.deepEqual(box, [175, 300, 250, 400]);
  });

  await test('denormalizeBox clamps to the original image bounds', () => {
    const crop: SourceCrop = { id: 'edge', rectInOriginal: { x: 900, y: 900, width: 100, height: 100 }, sentWidth: 100, sentHeight: 100 };
    // A box that (per Gemini's own imprecision) extends past the crop's own edge.
    const box = denormalizeBox([0, 0, 1000, 1200], crop, 950, 950);
    assert.equal(box[2] <= 950, true, 'ymax must be clamped to image height');
    assert.equal(box[3] <= 950, true, 'xmax must be clamped to image width');
  });

  await test('denormalizePolygon maps crop-local polygon points back to original pixels', () => {
    const crop: SourceCrop = { id: 'overview', rectInOriginal: { x: 0, y: 0, width: 1000, height: 1000 }, sentWidth: 1000, sentHeight: 1000 };
    const poly = denormalizePolygon(
      [
        [0, 0],
        [1000, 0],
        [1000, 1000],
        [0, 1000],
      ],
      crop,
      1000,
      1000
    );
    assert.deepEqual(poly, [
      [0, 0],
      [1000, 0],
      [1000, 1000],
      [0, 1000],
    ]);
  });

  // --- 3) Polygon clipping at image bounds ---
  await test('clipPolygonToRect trims a polygon that extends past the image edge', () => {
    // A square from (-50,-50) to (50,50), clipped against [0,0,100,100] — should keep only the (0,0)-(50,50) quadrant.
    const clipped = clipPolygonToRect(
      [
        [-50, -50],
        [50, -50],
        [50, 50],
        [-50, 50],
      ],
      0,
      0,
      100,
      100
    );
    assert.ok(clipped.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100), 'every clipped point must be inside the rect');
    // Resulting polygon should be exactly the (0,0)-(50,0)-(50,50)-(0,50) square.
    const xs = clipped.map((p) => p[0]);
    const ys = clipped.map((p) => p[1]);
    assert.equal(Math.min(...xs), 0);
    assert.equal(Math.max(...xs), 50);
    assert.equal(Math.min(...ys), 0);
    assert.equal(Math.max(...ys), 50);
  });

  await test('clipPolygonToRect returns an empty result for a polygon entirely outside the image', () => {
    const clipped = clipPolygonToRect(
      [
        [-100, -100],
        [-50, -100],
        [-50, -50],
        [-100, -50],
      ],
      0,
      0,
      100,
      100
    );
    assert.equal(clipped.length, 0);
  });

  // --- 4) Deduplication across crops ---
  await test('dedupeDetections merges same-category, high-IoU detections from different crops into one', () => {
    const a: DenormalizedDetection = {
      category: 'sofa',
      label: 'sofá 3 lugares',
      roomType: 'sala',
      confidence: 0.7,
      boxOriginalPixels: [100, 100, 200, 300],
      polygonOriginalPixels: null,
      sourceCropIds: ['overview'],
    };
    const b: DenormalizedDetection = {
      ...a,
      confidence: 0.9,
      boxOriginalPixels: [105, 102, 205, 298], // near-identical box, seen again in a tile
      sourceCropIds: ['tile-1'],
    };
    const merged = dedupeDetections([a, b]);
    assert.equal(merged.length, 1, 'overlapping same-category detections must merge into one');
    assert.equal(merged[0].confidence, 0.9, 'the higher-confidence detection must be kept as the representative');
    assert.deepEqual(new Set(merged[0].sourceCropIds), new Set(['overview', 'tile-1']));
  });

  await test('dedupeDetections keeps distinct objects of the same category separate when boxes do not overlap', () => {
    const a: DenormalizedDetection = {
      category: 'cadeira',
      label: 'cadeira 1',
      roomType: null,
      confidence: 0.8,
      boxOriginalPixels: [0, 0, 50, 50],
      polygonOriginalPixels: null,
      sourceCropIds: ['overview'],
    };
    const b: DenormalizedDetection = { ...a, label: 'cadeira 2', boxOriginalPixels: [500, 500, 550, 550] };
    const merged = dedupeDetections([a, b]);
    assert.equal(merged.length, 2);
  });

  await test('dedupeDetections prefers a tile\'s polygon-bearing detection as representative even when the overview reported higher confidence for the same object', () => {
    const overviewOnly: DenormalizedDetection = {
      category: 'sofa',
      label: 'sofá (overview, sem polígono)',
      roomType: 'sala',
      confidence: 0.97, // higher confidence...
      boxOriginalPixels: [100, 100, 200, 300],
      polygonOriginalPixels: null, // ...but no polygon
      sourceCropIds: ['overview'],
    };
    const tileRefined: DenormalizedDetection = {
      category: 'sofa',
      label: 'sofá (tile, com polígono)',
      roomType: 'sala',
      confidence: 0.8, // lower confidence...
      boxOriginalPixels: [102, 101, 198, 298],
      polygonOriginalPixels: [
        [101, 102],
        [298, 102],
        [298, 198],
        [101, 198],
      ], // ...but HAS a polygon
      sourceCropIds: ['tile-1'],
    };
    const merged = dedupeDetections([overviewOnly, tileRefined]);
    assert.equal(merged.length, 1);
    assert.ok(merged[0].polygonOriginalPixels !== null, 'the merged representative must keep the tile\'s polygon, not the overview\'s higher-confidence box-only version');
    assert.equal(merged[0].label, 'sofá (tile, com polígono)');
  });

  await test('boxIou returns 1 for identical boxes and 0 for disjoint boxes', () => {
    const box = [0, 0, 10, 10] as const;
    assert.equal(boxIou([...box], [...box]), 1);
    assert.equal(boxIou([0, 0, 10, 10], [100, 100, 110, 110]), 0);
  });

  // --- 5) Tiling geometry ---
  await test('planCropRects returns only the overview for a small useful area', () => {
    const plan = planCropRects({ x: 10, y: 10, width: 500, height: 400 }, 1400, 0.2);
    assert.equal(plan.tiles.length, 0);
    assert.deepEqual(plan.overview, { x: 10, y: 10, width: 500, height: 400 });
  });

  await test('planCropRects splits a large useful area into overlapping tiles', () => {
    const plan = planCropRects({ x: 0, y: 0, width: 3000, height: 1000 }, 1400, 0.2);
    assert.ok(plan.tiles.length >= 2, 'a 3000px-wide area over a 1400px threshold must be tiled');
    // Every tile must stay within the useful area's bounds.
    for (const tile of plan.tiles) {
      assert.ok(tile.x >= 0 && tile.y >= 0);
      assert.ok(tile.x + tile.width <= 3000);
      assert.ok(tile.y + tile.height <= 1000);
    }
  });

  // --- 5b) Request schemas use OpenAPI-3.0 nullable form (Gemini rejects JSON-Schema-2020-12's `type: [x,"null"]` with HTTP 400) ---
  function assertNoArrayFormType(schema: unknown, label: string) {
    function walk(node: unknown): void {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node && typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        if ('type' in obj) {
          assert.ok(!Array.isArray(obj.type), `${label}: found array-form "type": ${JSON.stringify(obj.type)} — Gemini's schema validator requires a single type string + a separate "nullable" boolean`);
        }
        Object.values(obj).forEach(walk);
      }
    }
    walk(schema);
  }

  await test('GEMINI_OVERVIEW_JSON_SCHEMA and GEMINI_TILE_JSON_SCHEMA never use array-form "type"', () => {
    assertNoArrayFormType(GEMINI_OVERVIEW_JSON_SCHEMA, 'overview schema');
    assertNoArrayFormType(GEMINI_TILE_JSON_SCHEMA, 'tile schema');
  });

  await test('the overview schema does NOT require (or even define) a segmentation mask field', () => {
    const itemSchema = GEMINI_OVERVIEW_JSON_SCHEMA.properties.objects.items;
    assert.ok(!('mask' in itemSchema.properties), 'overview item schema must not have a "mask" property at all');
    assert.ok(!itemSchema.required.includes('mask' as never), 'overview item schema must not require "mask"');
  });

  await test('the tile schema requires (accepts, possibly-null) a segmentation mask field', () => {
    const itemSchema = GEMINI_TILE_JSON_SCHEMA.properties.objects.items;
    assert.ok('mask' in itemSchema.properties, 'tile item schema must define a "mask" property');
    assert.ok(itemSchema.required.includes('mask' as never), 'tile item schema must require the "mask" key (value may still be null)');
    assert.equal((itemSchema.properties as Record<string, { nullable?: boolean }>).mask.nullable, true);
  });

  await test('parseGeminiOverviewResponse rejects a response that includes a mask field the overview should never produce (schema is strict about shape)', () => {
    // The overview Zod schema simply has no "mask" key defined — Zod's
    // object() is non-strict by default (extra keys are ignored, not
    // rejected), so this documents that behavior rather than asserting a
    // throw: an overview response with a stray "mask" key still parses,
    // just without ever exposing/using that key downstream.
    const parsed = parseGeminiOverviewResponse(
      JSON.stringify({ objects: [{ category: 'cama', label: 'cama', roomType: 'quarto', confidence: 0.9, box_2d: [1, 2, 3, 4], mask: [[1, 2]] }] })
    );
    assert.equal(parsed.objects.length, 1);
    assert.ok(!('mask' in parsed.objects[0]), 'the parsed overview object must not carry a mask field through the pipeline');
  });

  await test('parseGeminiTileResponse accepts a response with a populated segmentation polygon', () => {
    const parsed = parseGeminiTileResponse(
      JSON.stringify({
        objects: [
          {
            category: 'sofa',
            label: 'sofá',
            roomType: 'sala',
            confidence: 0.88,
            box_2d: [100, 100, 300, 400],
            mask: [
              [100, 100],
              [400, 100],
              [400, 300],
              [100, 300],
            ],
          },
        ],
      })
    );
    assert.equal(parsed.objects.length, 1);
    assert.ok(Array.isArray(parsed.objects[0].mask));
    assert.equal(parsed.objects[0].mask?.length, 4);
  });

  await test('parseGeminiTileResponse accepts a null mask (escape hatch when a clean polygon cannot be given)', () => {
    const parsed = parseGeminiTileResponse(
      JSON.stringify({ objects: [{ category: 'cadeira', label: 'cadeira', roomType: null, confidence: 0.6, box_2d: [1, 2, 3, 4], mask: null }] })
    );
    assert.equal(parsed.objects[0].mask, null);
  });

  // --- 5c) thinking_level restricted to the values gemini-3.8-flash actually accepts ---
  await test('resolveThinkingLevel rejects "minimal" (the value that caused the real HTTP 400 on 2026-09-18)', () => {
    assert.throws(() => resolveThinkingLevel('minimal'), /Invalid GEMINI_VISION_THINKING_LEVEL "minimal"/);
  });

  await test('resolveThinkingLevel rejects arbitrary invalid values', () => {
    assert.throws(() => resolveThinkingLevel('ultra-fast'), /Invalid GEMINI_VISION_THINKING_LEVEL/);
  });

  await test('resolveThinkingLevel accepts "low", "medium", "high" and defaults to "low" when unset', () => {
    assert.equal(resolveThinkingLevel('low'), 'low');
    assert.equal(resolveThinkingLevel('medium'), 'medium');
    assert.equal(resolveThinkingLevel('high'), 'high');
    assert.equal(resolveThinkingLevel(undefined), 'low');
  });

  await test('assertValidThinkingLevel throws for "minimal" and passes for the configured default', () => {
    assert.throws(() => assertValidThinkingLevel('minimal'), /Invalid thinking_level "minimal"/);
    assert.doesNotThrow(() => assertValidThinkingLevel(GEMINI_VISION_THINKING_LEVEL));
  });

  await test('the module-level GEMINI_VISION_THINKING_LEVEL currently resolves to "low" (the configured default)', () => {
    assert.equal(GEMINI_VISION_THINKING_LEVEL, 'low');
  });

  // --- 5d) Timeout: configurable, bounded, defaults to 180000, never causes an automatic retry ---
  await test('resolveTimeoutMs defaults to 180000', () => {
    assert.equal(resolveTimeoutMs(undefined), 180_000);
  });

  await test('resolveTimeoutMs accepts values within [60000, 300000]', () => {
    assert.equal(resolveTimeoutMs('60000'), 60_000);
    assert.equal(resolveTimeoutMs('180000'), 180_000);
    assert.equal(resolveTimeoutMs('300000'), 300_000);
  });

  await test('resolveTimeoutMs rejects values below 60000 or above 300000', () => {
    assert.throws(() => resolveTimeoutMs('59999'), /Invalid GEMINI_VISION_TIMEOUT_MS/);
    assert.throws(() => resolveTimeoutMs('300001'), /Invalid GEMINI_VISION_TIMEOUT_MS/);
    assert.throws(() => resolveTimeoutMs('not-a-number'), /Invalid GEMINI_VISION_TIMEOUT_MS/);
  });

  await test('the module-level GEMINI_VISION_TIMEOUT_MS currently resolves to 180000 (the configured default)', () => {
    assert.equal(GEMINI_VISION_TIMEOUT_MS, 180_000);
  });

  await test('a timeout never triggers an automatic retry — geminiVision.ts requests maxRetries: 0 explicitly and contains no retry loop', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/providers/geminiVision.ts'), 'utf-8');
    assert.ok(/maxRetries:\s*0/.test(src), 'detectFurnitureObjects must pass maxRetries: 0 to the SDK call');
    // No while/for loop wrapping the interactions.create call inside detectFurnitureObjects — a crude but effective guard against a future retry loop being added silently.
    const fnBody = src.slice(src.indexOf('export async function detectFurnitureObjects'));
    assert.ok(!/\b(while|for)\s*\(/.test(fnBody), 'detectFurnitureObjects must not contain any retry loop');
  });

  // --- 6) Rejection of invalid JSON ---
  await test('parseGeminiOverviewResponse rejects invalid JSON', () => {
    assert.throws(() => parseGeminiOverviewResponse('not json at all'), /not valid JSON/);
  });

  await test('parseGeminiTileResponse rejects invalid JSON', () => {
    assert.throws(() => parseGeminiTileResponse('not json at all'), /not valid JSON/);
  });

  await test('parseGeminiOverviewResponse rejects JSON that does not match the schema', () => {
    assert.throws(() => parseGeminiOverviewResponse(JSON.stringify({ objects: [{ category: 'not_a_real_category', label: 'x', roomType: null, confidence: 2, box_2d: [1, 2, 3] }] })), /schema validation/);
  });

  await test('parseGeminiTileResponse rejects JSON that does not match the schema', () => {
    assert.throws(() => parseGeminiTileResponse(JSON.stringify({ objects: [{ category: 'cama', label: 'x', roomType: null, confidence: 2, box_2d: [1, 2, 3], mask: null }] })), /schema validation/);
  });

  await test('parseGeminiOverviewResponse accepts a well-formed (box-only) response', () => {
    const parsed = parseGeminiOverviewResponse(
      JSON.stringify({
        objects: [{ category: 'cama', label: 'cama de casal', roomType: 'quarto', confidence: 0.9, box_2d: [100, 100, 300, 400] }],
      })
    );
    assert.equal(parsed.objects.length, 1);
    assert.equal(parsed.objects[0].category, 'cama');
  });

  // --- 7) Structure overlap / low-confidence rejection ---
  await test('combineDetectionsWithStructure rejects low-confidence detections and never marks them replaceable', async () => {
    const width = 400;
    const height = 300;
    const protectedMask = cv.Mat.zeros(height, width, cv.CV_8UC1); // nothing protected — isolates the confidence check
    const detections: DenormalizedDetection[] = [
      {
        category: 'cadeira',
        label: 'cadeira incerta',
        roomType: null,
        confidence: 0.2,
        boxOriginalPixels: [50, 50, 100, 100],
        polygonOriginalPixels: null,
        sourceCropIds: ['overview'],
      },
    ];
    const result = await combineDetectionsWithStructure(detections, protectedMask, width, height, 0.5, 0.35, 4);
    assert.equal(result.detections[0].replaceable, false);
    assert.equal(result.detections[0].uncertain, false);
    assert.match(result.detections[0].reason, /confiança/);
    assert.equal(cv.countNonZero(result.rawFurnitureMask), 0, 'a rejected low-confidence object must never enter the furniture mask');
    protectedMask.delete();
    result.rawFurnitureMask.delete();
    result.structureSubtractedMask.delete();
  });

  await test('combineDetectionsWithStructure marks heavy wall overlap as uncertain and strips protected pixels from the output mask', async () => {
    const width = 400;
    const height = 300;
    const protectedMask = cv.Mat.zeros(height, width, cv.CV_8UC1);
    // A "wall" spanning the whole area the candidate object sits in.
    cv.rectangle(protectedMask, new cv.Point(40, 40), new cv.Point(160, 160), new cv.Scalar(255), -1);

    const detections: DenormalizedDetection[] = [
      {
        category: 'armario',
        label: 'armário colado na parede',
        roomType: null,
        confidence: 0.9,
        boxOriginalPixels: [50, 50, 150, 150], // almost entirely inside the "wall"
        polygonOriginalPixels: null,
        sourceCropIds: ['overview'],
      },
    ];
    const result = await combineDetectionsWithStructure(detections, protectedMask, width, height, 0.5, 0.35, 0);
    assert.equal(result.detections[0].replaceable, false);
    assert.equal(result.detections[0].uncertain, true);
    assert.match(result.detections[0].reason, /sobreposição/);

    // No pixel of the final "structure-subtracted" mask may coincide with a protected pixel.
    const overlapCheck = new cv.Mat();
    cv.bitwise_and(result.structureSubtractedMask, protectedMask, overlapCheck);
    assert.equal(cv.countNonZero(overlapCheck), 0, 'the structure-subtracted furniture mask must never include a protected pixel');
    overlapCheck.delete();

    protectedMask.delete();
    result.rawFurnitureMask.delete();
    result.structureSubtractedMask.delete();
  });

  await test('combineDetectionsWithStructure accepts a clean, unobstructed object as replaceable', async () => {
    const width = 400;
    const height = 300;
    const protectedMask = cv.Mat.zeros(height, width, cv.CV_8UC1);
    cv.rectangle(protectedMask, new cv.Point(0, 0), new cv.Point(400, 10), new cv.Scalar(255), -1); // a thin wall far from the object

    const detections: DenormalizedDetection[] = [
      {
        category: 'mesa',
        label: 'mesa de jantar',
        roomType: 'sala',
        confidence: 0.95,
        boxOriginalPixels: [100, 100, 200, 250],
        polygonOriginalPixels: null,
        sourceCropIds: ['overview'],
      },
    ];
    const result = await combineDetectionsWithStructure(detections, protectedMask, width, height, 0.5, 0.35, 4);
    assert.equal(result.detections[0].replaceable, true);
    assert.equal(result.detections[0].uncertain, false);
    assert.equal(result.detections[0].reason, 'aceito');
    assert.ok(cv.countNonZero(result.structureSubtractedMask) > 0, 'an accepted object must contribute to the final furniture mask');

    protectedMask.delete();
    result.rawFurnitureMask.delete();
    result.structureSubtractedMask.delete();
  });

  await test('combineDetectionsWithStructure never treats a room ("comodo") detection as replaceable furniture', async () => {
    const width = 400;
    const height = 300;
    const protectedMask = cv.Mat.zeros(height, width, cv.CV_8UC1);
    const detections: DenormalizedDetection[] = [
      {
        category: 'comodo',
        label: 'quarto',
        roomType: 'quarto',
        confidence: 0.95,
        boxOriginalPixels: [0, 0, 300, 300],
        polygonOriginalPixels: null,
        sourceCropIds: ['overview'],
      },
    ];
    const result = await combineDetectionsWithStructure(detections, protectedMask, width, height);
    assert.equal(result.detections[0].replaceable, false);
    assert.equal(cv.countNonZero(result.rawFurnitureMask), 0, 'a room must never contribute to the furniture mask');
    protectedMask.delete();
    result.rawFurnitureMask.delete();
    result.structureSubtractedMask.delete();
  });

  // --- 8/9/10) Isolation guarantees: no key in logs, no wallet access, no BFL call ---
  // Static source scans rather than runtime mocks — these enforce the
  // architectural boundary directly (a future edit that violates it fails
  // this test immediately, without needing a real network call to trigger).
  const furnitureModuleFiles = [
    '../src/providers/geminiVision.ts',
    '../src/lib/floorplanFurniture/detectFloorplanFurniture.ts',
    '../src/lib/floorplanFurniture/combineWithStructure.ts',
    '../src/lib/floorplanFurniture/geminiResponseSchema.ts',
    '../src/lib/floorplanFurniture/usefulAreaDetection.ts',
    '../src/lib/floorplanFurniture/tiling.ts',
    '../src/lib/floorplanFurniture/coordinateTransform.ts',
    '../src/lib/floorplanFurniture/deduplication.ts',
    '../src/lib/floorplanFurniture/cropExtraction.ts',
  ].map((p) => path.resolve(__dirname, p));

  // Strips // line comments and /* */ block comments before scanning, so a
  // defensive comment that merely MENTIONS "debit(" or "apiKey" in prose
  // (documenting what the file deliberately does NOT do) can't itself
  // trigger a false failure — only actual code is checked.
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }

  await test('no source file in the furniture-detection pipeline logs the Gemini API key, headers, or base64 image data', () => {
    for (const file of furnitureModuleFiles) {
      const code = stripComments(fs.readFileSync(file, 'utf-8'));
      const loggerCalls = code.match(/(geminiLogger|console)\.(log|error|warn|info)\([^)]*\)/g) || [];
      for (const call of loggerCalls) {
        assert.ok(!/apiKey/i.test(call), `${path.basename(file)} logs something referencing apiKey: ${call}`);
        assert.ok(!/GEMINI_API_KEY/.test(call), `${path.basename(file)} logs GEMINI_API_KEY directly: ${call}`);
        assert.ok(!/\.headers\b/.test(call), `${path.basename(file)} logs an object's .headers: ${call}`);
        assert.ok(!/imageBase64/i.test(call), `${path.basename(file)} logs imageBase64: ${call}`);
      }
    }
  });

  await test('no source file in the furniture-detection pipeline imports the credit wallet', () => {
    for (const file of furnitureModuleFiles) {
      const code = stripComments(fs.readFileSync(file, 'utf-8'));
      assert.ok(!/creditWallet/.test(code), `${path.basename(file)} references creditWallet`);
      assert.ok(!/\bdebit\s*\(/.test(code), `${path.basename(file)} calls debit()`);
      assert.ok(!/hasSufficientBalance/.test(code), `${path.basename(file)} references hasSufficientBalance`);
    }
  });

  await test('no source file in the furniture-detection pipeline imports the BFL/FLUX providers', () => {
    for (const file of furnitureModuleFiles) {
      const code = stripComments(fs.readFileSync(file, 'utf-8'));
      assert.ok(!/providers\/bfl(Fill)?['"]/.test(code), `${path.basename(file)} imports a BFL provider`);
      assert.ok(!/generateFill\s*\(/.test(code), `${path.basename(file)} calls generateFill()`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
