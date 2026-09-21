/**
 * Phase 1 of the offline audit for job 639d7899-... / result 93530114-...:
 * reconstruct the crop geometry (deterministic, same pure functions the
 * route uses) and cross-check it against the REAL saved per-crop
 * cropWidth/cropHeight before trusting the reconstruction for anything
 * else. No network call — pure OpenCV + pure geometry functions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getOpenCv } from '../src/lib/floorplanMask/opencvRuntime';
import { decodeToMat } from '../src/lib/floorplanMask/imageIO';
import { detectUsefulArea } from '../src/lib/floorplanFurniture/usefulAreaDetection';
import { planCropRects } from '../src/lib/floorplanFurniture/tiling';
import { extractCrop } from '../src/lib/floorplanFurniture/cropExtraction';
import { mapBoxToOriginal, mapPolygonToOriginal } from '../src/lib/floorplanFurniture/openaiCoordinateTransform';
import { dedupeOpenAIObjects, dedupeOpenAIRooms } from '../src/lib/floorplanFurniture/deduplicationOpenAI';
import { combineOpenAIWithStructure } from '../src/lib/floorplanFurniture/combineWithStructureOpenAI';
import { buildFloorplanMask } from '../src/lib/floorplanMask/buildMask';
import { decodeMaskToProtectedMat } from '../src/lib/floorplanMask/maskIO';
import { DenormalizedOpenAIObject, DenormalizedOpenAIRoom } from '../src/lib/floorplanFurniture/openaiTypes';

const RUN_DIR = path.resolve(__dirname, '../test-output/humanized-floorplan-real-execution-04');
const AUDIT_DIR = path.resolve(__dirname, '../test-output/humanized-floorplan-audit-run04');

async function main() {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  const cv = await getOpenCv();

  const originalBuffer = fs.readFileSync(path.join(RUN_DIR, '01-original.jpg'));
  const confirmedMaskBuffer = fs.readFileSync(path.join(RUN_DIR, '02-mascara-confirmada.png'));
  const visionDiagnostics = JSON.parse(fs.readFileSync(path.join(RUN_DIR, '06-vision-detection-diagnostics.json'), 'utf8'));

  const { mat: originalRgba, width: originalWidth, height: originalHeight } = await decodeToMat(originalBuffer);

  // --- Reconstruct the exact crop geometry the OpenAI vision step used (deterministic given the same image) ---
  const usefulArea = await detectUsefulArea(originalRgba);
  const { overview, tiles } = planCropRects(usefulArea);
  const overviewExtracted = await extractCrop(originalRgba, overview, 'overview');
  const tile1Extracted = await extractCrop(originalRgba, tiles[0], 'tile-1');
  const tile2Extracted = await extractCrop(originalRgba, tiles[1], 'tile-2');

  console.log('=== Reconstructed crop geometry vs. real saved diagnostics ===');
  console.log('usefulArea:', usefulArea);
  console.log('overview rectInOriginal:', overviewExtracted.crop.rectInOriginal, 'sent:', overviewExtracted.crop.sentWidth, 'x', overviewExtracted.crop.sentHeight);
  console.log('  real saved cropWidth/cropHeight:', visionDiagnostics['overview.json'].cropWidth, 'x', visionDiagnostics['overview.json'].cropHeight);
  console.log('tile-1 rectInOriginal:', tile1Extracted.crop.rectInOriginal, 'sent:', tile1Extracted.crop.sentWidth, 'x', tile1Extracted.crop.sentHeight);
  console.log('  real saved cropWidth/cropHeight:', visionDiagnostics['tile-1.json'].cropWidth, 'x', visionDiagnostics['tile-1.json'].cropHeight);
  console.log('tile-2 rectInOriginal:', tile2Extracted.crop.rectInOriginal, 'sent:', tile2Extracted.crop.sentWidth, 'x', tile2Extracted.crop.sentHeight);
  console.log('  real saved cropWidth/cropHeight:', visionDiagnostics['tile-2.json'].cropWidth, 'x', visionDiagnostics['tile-2.json'].cropHeight);

  const overviewMatches = overviewExtracted.crop.sentWidth === visionDiagnostics['overview.json'].cropWidth && overviewExtracted.crop.sentHeight === visionDiagnostics['overview.json'].cropHeight;
  const tile1Matches = tile1Extracted.crop.sentWidth === visionDiagnostics['tile-1.json'].cropWidth && tile1Extracted.crop.sentHeight === visionDiagnostics['tile-1.json'].cropHeight;
  const tile2Matches = tile2Extracted.crop.sentWidth === visionDiagnostics['tile-2.json'].cropWidth && tile2Extracted.crop.sentHeight === visionDiagnostics['tile-2.json'].cropHeight;
  console.log('\nReconstruction fidelity check: overview=', overviewMatches, 'tile1=', tile1Matches, 'tile2=', tile2Matches);
  if (!overviewMatches || !tile1Matches || !tile2Matches) {
    console.error('MISMATCH — reconstruction is not trustworthy, stopping before building anything on top of it.');
    process.exit(1);
  }

  // --- Map every accepted object/room from crop-local pixels to original-image pixels ---
  const allObjects: DenormalizedOpenAIObject[] = [];
  const allRooms: DenormalizedOpenAIRoom[] = [];
  const crops = [
    { json: visionDiagnostics['overview.json'], extracted: overviewExtracted },
    { json: visionDiagnostics['tile-1.json'], extracted: tile1Extracted },
    { json: visionDiagnostics['tile-2.json'], extracted: tile2Extracted },
  ];
  for (const { json, extracted } of crops) {
    for (const room of json.acceptedRooms) {
      allRooms.push({
        id: room.id,
        type: room.type,
        label: room.label,
        confidence: room.confidence,
        boxOriginalPixels: mapBoxToOriginal(room.box, extracted.crop, originalWidth, originalHeight),
        sourceCropIds: [extracted.crop.id],
      });
    }
    for (const obj of json.acceptedObjects) {
      allObjects.push({
        id: obj.id,
        category: obj.category,
        subcategory: obj.subcategory,
        roomType: obj.roomType,
        confidence: obj.confidence,
        orientationDegrees: obj.orientationDegrees,
        boxOriginalPixels: mapBoxToOriginal(obj.box, extracted.crop, originalWidth, originalHeight),
        polygonOriginalPixels: obj.polygon ? mapPolygonToOriginal(obj.polygon, extracted.crop, originalWidth, originalHeight) : null,
        replaceable: obj.replaceable,
        notes: obj.notes,
        sourceCropIds: [extracted.crop.id],
      });
    }
  }
  console.log(`\nTotal objects before dedup: ${allObjects.length}, rooms before dedup: ${allRooms.length}`);

  const dedupedObjects = dedupeOpenAIObjects(allObjects);
  const dedupedRooms = dedupeOpenAIRooms(allRooms);
  console.log(`After dedup: ${dedupedObjects.length} objects, ${dedupedRooms.length} rooms`);
  console.log('Real job.result reported: 42 objects, 8 rooms — match:', dedupedObjects.length === 42, dedupedRooms.length === 8);

  // --- Recompute the REAL structural protected mask two ways and confirm they're identical ---
  const freshMask = await buildFloorplanMask(originalBuffer);
  const decodedFromConfirmedFile = await decodeMaskToProtectedMat(confirmedMaskBuffer, originalWidth, originalHeight);
  const diff = new cv.Mat();
  cv.absdiff(freshMask.protectedMask, decodedFromConfirmedFile, diff);
  const maskDiffNonZero = cv.countNonZero(diff);
  console.log(`\nprotectedMask (freshly recomputed) vs. decoded confirmed-mask file: ${maskDiffNonZero} differing pixels (0 expected, since the confirmed mask was the unedited auto mask).`);
  diff.delete();

  // --- Combine with structure (pure, offline) — the REAL final 42-object verdicts ---
  const combined = await combineOpenAIWithStructure(dedupedObjects, dedupedRooms, freshMask.protectedMask, originalWidth, originalHeight);
  const replaceableCount = combined.objects.filter((o) => o.replaceable).length;
  const uncertainCount = combined.objects.filter((o) => o.uncertain).length;
  const rejectedCount = combined.objects.filter((o) => !o.replaceable && !o.uncertain).length;
  console.log(`\nFinal verdicts: ${replaceableCount} replaceable, ${uncertainCount} uncertain, ${rejectedCount} rejected (confidence too low)`);

  fs.writeFileSync(path.join(AUDIT_DIR, 'phase1-reconstructed-objects.json'), JSON.stringify(combined.objects, null, 2));
  fs.writeFileSync(path.join(AUDIT_DIR, 'phase1-reconstructed-rooms.json'), JSON.stringify(combined.rooms, null, 2));

  originalRgba.delete();
  overviewExtracted && null;
  freshMask.protectedMask.delete();
  freshMask.wallsMaskOriginalRes.delete();
  freshMask.textProtectionMaskOriginalRes.delete();
  decodedFromConfirmedFile.delete();
  combined.rawFurnitureMask.delete();
  combined.structureSubtractedMask.delete();

  console.log(`\nSaved: ${path.join(AUDIT_DIR, 'phase1-reconstructed-objects.json')}`);
}

main().catch((err) => {
  console.error('Audit phase 1 crashed:', err);
  process.exit(1);
});
