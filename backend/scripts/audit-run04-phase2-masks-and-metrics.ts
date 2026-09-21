/**
 * Phase 2 of the offline audit for job 639d7899-... / result 93530114-...:
 * builds every requested mask visualization, the full per-object table (42
 * deduplicated objects), pixel-polarity samples, the exact prompt/params
 * sent to FLUX, visual quality metrics on the final result, and a
 * (diagnostic-only, NOT wired into the live pipeline) visual-quality gate.
 *
 * 100% offline: no OpenAI/FLUX/Gemini call. Reuses only already-saved real
 * artifacts + deterministic pure functions already in this codebase.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getOpenCv, OpenCv } from '../src/lib/floorplanMask/opencvRuntime';
import { decodeToMat, encodeMatToPng } from '../src/lib/floorplanMask/imageIO';
import { buildWorkingImage } from '../src/lib/floorplanMask/preprocess';
import { detectStructure } from '../src/lib/floorplanMask/detectStructure';
import { decodeMaskToProtectedMat } from '../src/lib/floorplanMask/maskIO';
import { detectUsefulArea } from '../src/lib/floorplanFurniture/usefulAreaDetection';
import { planCropRects } from '../src/lib/floorplanFurniture/tiling';
import { extractCrop } from '../src/lib/floorplanFurniture/cropExtraction';
import { mapBoxToOriginal, mapPolygonToOriginal } from '../src/lib/floorplanFurniture/openaiCoordinateTransform';
import { dedupeOpenAIObjects, dedupeOpenAIRooms } from '../src/lib/floorplanFurniture/deduplicationOpenAI';
import { combineOpenAIWithStructure } from '../src/lib/floorplanFurniture/combineWithStructureOpenAI';
import { OPENAI_VISION_FURNITURE_SAFETY_MARGIN_PX } from '../src/config/openaiModels';
import { DenormalizedOpenAIObject, DenormalizedOpenAIRoom, FinalOpenAIObject } from '../src/lib/floorplanFurniture/openaiTypes';

type Mat = InstanceType<OpenCv['Mat']>;

const RUN_DIR = path.resolve(__dirname, '../test-output/humanized-floorplan-real-execution-04');
const AUDIT_DIR = path.resolve(__dirname, '../test-output/humanized-floorplan-audit-run04');
const USEFUL_AREA_RECT_FOR_FLUX = { x: 0, y: 377, width: 1755, height: 487 }; // logged real value for this job — see 09-resumo.json

async function savePng(cv: OpenCv, mat: Mat, filename: string) {
  fs.writeFileSync(path.join(AUDIT_DIR, filename), await encodeMatToPng(mat));
}

function rasterize(cv: OpenCv, det: { boxOriginalPixels: { xMin: number; yMin: number; xMax: number; yMax: number }; polygonOriginalPixels: { x: number; y: number }[] | null }, width: number, height: number): Mat {
  if (det.polygonOriginalPixels && det.polygonOriginalPixels.length >= 3) {
    const mask = cv.Mat.zeros(height, width, cv.CV_8UC1);
    const flat = det.polygonOriginalPixels.flatMap((p) => [Math.round(p.x), Math.round(p.y)]);
    const contour = cv.matFromArray(det.polygonOriginalPixels.length, 1, cv.CV_32SC2, flat);
    const contours = new cv.MatVector();
    contours.push_back(contour);
    cv.drawContours(mask, contours, 0, new cv.Scalar(255), -1);
    contour.delete();
    contours.delete();
    return mask;
  }
  const mask = cv.Mat.zeros(height, width, cv.CV_8UC1);
  const b = det.boxOriginalPixels;
  cv.rectangle(mask, new cv.Point(Math.round(b.xMin), Math.round(b.yMin)), new cv.Point(Math.round(b.xMax), Math.round(b.yMax)), new cv.Scalar(255), -1);
  return mask;
}

async function main() {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  const cv = await getOpenCv();

  const originalBuffer = fs.readFileSync(path.join(RUN_DIR, '01-original.jpg'));
  const confirmedMaskBuffer = fs.readFileSync(path.join(RUN_DIR, '02-mascara-confirmada.png'));
  const finalResultBuffer = fs.readFileSync(path.join(RUN_DIR, '12-resultado-final.png'));
  const visionDiagnostics = JSON.parse(fs.readFileSync(path.join(RUN_DIR, '06-vision-detection-diagnostics.json'), 'utf8'));
  const statusFinal = JSON.parse(fs.readFileSync(path.join(RUN_DIR, '03-status-final.json'), 'utf8'));

  const { mat: originalRgba, width, height } = await decodeToMat(originalBuffer);
  const { mat: finalResultRgba } = await decodeToMat(finalResultBuffer);

  // --- The REAL, actually-used protected mask (decoded from the exact file sent as maskOverride) ---
  const protectedMask = await decodeMaskToProtectedMat(confirmedMaskBuffer, width, height);
  const fillMask = new cv.Mat();
  cv.bitwise_not(protectedMask, fillMask);

  // --- Recompute the day-1 structural components (walls/furniture-blobs/text/arcs) — these algorithms are unchanged since the confirmed-mask file was generated, so they accurately reflect what's actually IN protectedMask. ---
  const { gray, enhanced, scaleToOriginal } = await buildWorkingImage(originalRgba, width, height);
  const detection = await detectStructure(gray, enhanced);
  function toOriginalRes(mat: Mat): Mat {
    const out = new cv.Mat();
    if (mat.cols !== width || mat.rows !== height) {
      cv.resize(mat, out, new cv.Size(width, height), 0, 0, cv.INTER_NEAREST);
    } else {
      mat.copyTo(out);
    }
    return out;
  }
  const wallsMaskOrig = toOriginalRes(detection.wallsMask);
  const cvFurnitureMaskOrig = toOriginalRes(detection.furnitureMask);
  const textMaskOrig = toOriginalRes(detection.textMask);
  const archesMaskOrig = toOriginalRes(detection.archesMask);
  gray.delete();
  enhanced.delete();
  detection.wallsMask.delete();
  detection.furnitureMask.delete();
  detection.textMask.delete();
  detection.archesMask.delete();
  detection.combinedMask.delete();
  void scaleToOriginal;

  await savePng(cv, wallsMaskOrig, '01-mascara-estrutural-rigida.png');
  await savePng(cv, textMaskOrig, '02-mascara-textos-cotas.png');

  // --- Reconstruct the 42 deduplicated OpenAI objects (validated exact match in phase 1) ---
  const usefulArea = await detectUsefulArea(originalRgba);
  const { overview, tiles } = planCropRects(usefulArea);
  const overviewExtracted = await extractCrop(originalRgba, overview, 'overview');
  const tile1Extracted = await extractCrop(originalRgba, tiles[0], 'tile-1');
  const tile2Extracted = await extractCrop(originalRgba, tiles[1], 'tile-2');

  const allObjects: DenormalizedOpenAIObject[] = [];
  const allRooms: DenormalizedOpenAIRoom[] = [];
  for (const { json, extracted } of [
    { json: visionDiagnostics['overview.json'], extracted: overviewExtracted },
    { json: visionDiagnostics['tile-1.json'], extracted: tile1Extracted },
    { json: visionDiagnostics['tile-2.json'], extracted: tile2Extracted },
  ]) {
    for (const room of json.acceptedRooms) {
      allRooms.push({ id: room.id, type: room.type, label: room.label, confidence: room.confidence, boxOriginalPixels: mapBoxToOriginal(room.box, extracted.crop, width, height), sourceCropIds: [extracted.crop.id] });
    }
    for (const obj of json.acceptedObjects) {
      allObjects.push({
        id: obj.id,
        category: obj.category,
        subcategory: obj.subcategory,
        roomType: obj.roomType,
        confidence: obj.confidence,
        orientationDegrees: obj.orientationDegrees,
        boxOriginalPixels: mapBoxToOriginal(obj.box, extracted.crop, width, height),
        polygonOriginalPixels: obj.polygon ? mapPolygonToOriginal(obj.polygon, extracted.crop, width, height) : null,
        replaceable: obj.replaceable,
        notes: obj.notes,
        sourceCropIds: [extracted.crop.id],
      });
    }
  }
  const dedupedObjects = dedupeOpenAIObjects(allObjects);
  const dedupedRooms = dedupeOpenAIRooms(allRooms);
  const combined = await combineOpenAIWithStructure(dedupedObjects, dedupedRooms, protectedMask, width, height);

  // --- Per-object detailed table (requirement #2) ---
  const dilateKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(OPENAI_VISION_FURNITURE_SAFETY_MARGIN_PX * 2 + 1, OPENAI_VISION_FURNITURE_SAFETY_MARGIN_PX * 2 + 1));
  const dilatedStructure = new cv.Mat();
  cv.dilate(protectedMask, dilatedStructure, dilateKernel);
  dilateKernel.delete();

  const substitutableMask = cv.Mat.zeros(height, width, cv.CV_8UC1);
  const nonSubstitutableMask = cv.Mat.zeros(height, width, cv.CV_8UC1);

  const objectTable: Record<string, unknown>[] = [];
  for (const obj of combined.objects as FinalOpenAIObject[]) {
    const candidateMask = rasterize(cv, obj, width, height);
    const areaPx = cv.countNonZero(candidateMask);
    let overlapRatio = 0;
    if (areaPx > 0) {
      const overlap = new cv.Mat();
      cv.bitwise_and(candidateMask, dilatedStructure, overlap);
      overlapRatio = cv.countNonZero(overlap) / areaPx;
      overlap.delete();
    }
    // Polarity in the REAL fillMask under this object's own pixels.
    let blackCount = 0;
    let whiteCount = 0;
    if (areaPx > 0) {
      const underFill = new cv.Mat();
      cv.bitwise_and(candidateMask, fillMask, underFill);
      whiteCount = cv.countNonZero(underFill);
      blackCount = areaPx - whiteCount;
      underFill.delete();
    }
    const majority = whiteCount >= blackCount ? 'branco (editável)' : 'preto (preservado)';
    const majorityPct = areaPx > 0 ? (Math.max(whiteCount, blackCount) / areaPx) * 100 : 0;

    if (obj.replaceable) {
      cv.bitwise_or(substitutableMask, candidateMask, substitutableMask);
    } else {
      cv.bitwise_or(nonSubstitutableMask, candidateMask, nonSubstitutableMask);
    }
    candidateMask.delete();

    objectTable.push({
      id: obj.id,
      category: obj.category,
      subcategory: obj.subcategory,
      confidence: Number(obj.confidence.toFixed(3)),
      modelReplaceable: obj.modelReplaceable,
      replaceableFinal: obj.replaceable,
      uncertain: obj.uncertain,
      areaPx,
      overlapWithStructurePct: Number((overlapRatio * 100).toFixed(1)),
      reason: obj.reason,
      maskPolarity: majority,
      maskPolarityPct: Number(majorityPct.toFixed(1)),
    });
  }
  dilatedStructure.delete();
  fs.writeFileSync(path.join(AUDIT_DIR, '08-objetos-42-detalhados.json'), JSON.stringify(objectTable, null, 2));

  await savePng(cv, substitutableMask, '04-mascara-moveis-substituiveis.png');

  // Stairs (category === 'escada') rasterized separately for the doors/windows/stairs visualization.
  const stairsMask = cv.Mat.zeros(height, width, cv.CV_8UC1);
  for (const obj of combined.objects as FinalOpenAIObject[]) {
    if (obj.category === 'escada') {
      const m = rasterize(cv, obj, width, height);
      cv.bitwise_or(stairsMask, m, stairsMask);
      m.delete();
    }
  }
  const doorsArchesStairsMask = new cv.Mat();
  cv.bitwise_or(archesMaskOrig, stairsMask, doorsArchesStairsMask);
  await savePng(cv, doorsArchesStairsMask, '03-mascara-portas-arcos-escadas.png');

  // Floor/editable = fillMask minus every specific detected category.
  const floorMask = new cv.Mat();
  fillMask.copyTo(floorMask);
  for (const m of [wallsMaskOrig, textMaskOrig, cvFurnitureMaskOrig, archesMaskOrig, substitutableMask, nonSubstitutableMask]) {
    const notM = new cv.Mat();
    cv.bitwise_not(m, notM);
    cv.bitwise_and(floorMask, notM, floorMask);
    notM.delete();
  }
  await savePng(cv, floorMask, '05-mascara-pisos-editaveis.png');

  // --- Final mask actually sent to FLUX (crop of the REAL fillMask to the logged useful-area rect) ---
  const fluxMaskRoi = fillMask.roi(new cv.Rect(USEFUL_AREA_RECT_FOR_FLUX.x, USEFUL_AREA_RECT_FOR_FLUX.y, USEFUL_AREA_RECT_FOR_FLUX.width, USEFUL_AREA_RECT_FOR_FLUX.height));
  const fluxMaskCrop = new cv.Mat();
  fluxMaskRoi.copyTo(fluxMaskCrop);
  fluxMaskRoi.delete();
  await savePng(cv, fluxMaskCrop, '06-mascara-final-enviada-flux.png');
  fluxMaskCrop.delete();

  // --- Colored composite overlay (requirement #1, last item) ---
  const overlay = new cv.Mat();
  originalRgba.copyTo(overlay);
  function tint(mask: Mat, color: [number, number, number], alpha: number) {
    const colored = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(color[0], color[1], color[2], 255));
    const blended = new cv.Mat();
    cv.addWeighted(overlay, 1 - alpha, colored, alpha, 0, blended);
    blended.copyTo(overlay, mask);
    colored.delete();
    blended.delete();
  }
  tint(wallsMaskOrig, [40, 40, 40], 0.85); // dark gray — rigid structure
  tint(textMaskOrig, [0, 220, 220], 0.85); // cyan — text/cotas
  tint(cvFurnitureMaskOrig, [255, 140, 0], 0.55); // orange — classical CV furniture-blob protection
  tint(doorsArchesStairsMask, [160, 32, 240], 0.7); // purple — doors/arcs/stairs
  tint(nonSubstitutableMask, [220, 0, 0], 0.5); // red (RGBA scalar order confirmed elsewhere in this codebase — R,G,B,A) — non-substitutable/uncertain furniture
  tint(substitutableMask, [0, 200, 0], 0.55); // green — substitutable furniture
  await savePng(cv, overlay, '07-sobreposicao-colorida.png');
  overlay.delete();

  // --- Pixel-polarity samples (requirement #3) ---
  function sampleAt(x: number, y: number, label: string) {
    const fillVal = fillMask.ucharPtr(y, x)[0];
    return { label, x, y, fillMaskValue: fillVal, polarity: fillVal > 127 ? 'branco (255) = editável' : 'preto (0) = preservado' };
  }
  const bed = objectTable.find((o) => o.category === 'cama');
  const sofa = objectTable.find((o) => o.category === 'sofa');
  const car = objectTable.find((o) => o.category === 'veiculo');
  function centerOf(id: unknown) {
    const obj = (combined.objects as FinalOpenAIObject[]).find((o) => o.id === id);
    if (!obj) return null;
    const b = obj.boxOriginalPixels;
    return { x: Math.round((b.xMin + b.xMax) / 2), y: Math.round((b.yMin + b.yMax) / 2) };
  }
  const samples = [
    sampleAt(20, Math.round(height / 2), 'parede externa (borda esquerda)'),
    sampleAt(Math.round(width / 2), Math.round(height / 2), 'piso/área aberta (centro da planta)'),
    ...(bed && centerOf(bed.id) ? [sampleAt(centerOf(bed.id)!.x, centerOf(bed.id)!.y, `cama (obj ${bed.id})`)] : []),
    ...(sofa && centerOf(sofa.id) ? [sampleAt(centerOf(sofa.id)!.x, centerOf(sofa.id)!.y, `sofá (obj ${sofa.id})`)] : []),
    ...(car && centerOf(car.id) ? [sampleAt(centerOf(car.id)!.x, centerOf(car.id)!.y, `carro (obj ${car.id})`)] : []),
    sampleAt(10, 10, 'área externa ao recorte útil (canto superior esquerdo, fora da faixa enviada ao FLUX)'),
  ];
  fs.writeFileSync(path.join(AUDIT_DIR, '09-amostras-polaridade.json'), JSON.stringify({ convencao: 'preto(0)=preservado, branco(255)=editável — convenção interna; o arquivo enviado ao FLUX é o INVERSO (preto=preservar) por exigência da própria API BFL, já aplicada aqui: fillMask JÁ está na convenção interna (branco=editável)', samples }, null, 2));

  // --- Prompt and parameters actually sent to FLUX (requirement #4) ---
  const promptParams = {
    endpoint: 'https://api.bfl.ai/v1/flux-pro-1.0-fill (BFL_BASE_URL + /v1/flux-pro-1.0-fill, providers/bflFill.ts)',
    model: statusFinal.result.model,
    steps: 'não enviado explicitamente pelo runner -> default HUMANIZED_FLOORPLAN_DEFAULT_STEPS = 50',
    guidance: 'não enviado explicitamente pelo runner -> default HUMANIZED_FLOORPLAN_DEFAULT_GUIDANCE = 30',
    output_format: 'png (fixo, useful-area fix — sempre PNG desde a correção de margens)',
    safety_tolerance: 2,
    dimensõesEnviadas: `${USEFUL_AREA_RECT_FOR_FLUX.width}x${USEFUL_AREA_RECT_FOR_FLUX.height} (recorte útil, NÃO a imagem original 1755x1241)`,
    promptCompleto: statusFinal.result.prompt,
  };
  fs.writeFileSync(path.join(AUDIT_DIR, '10-prompt-e-parametros.json'), JSON.stringify(promptParams, null, 2));

  // --- Visual metrics on the FINAL result (requirement #5) ---
  const hsv = new cv.Mat();
  cv.cvtColor(finalResultRgba, hsv, cv.COLOR_RGBA2RGB);
  const hsvConverted = new cv.Mat();
  cv.cvtColor(hsv, hsvConverted, cv.COLOR_RGB2HSV);
  hsv.delete();
  const hsvChannels = new cv.MatVector();
  cv.split(hsvConverted, hsvChannels);
  const satChannel = hsvChannels.get(1);
  const valChannel = hsvChannels.get(2);
  const meanSat = cv.mean(satChannel)[0];

  // Dominant-color count: quantize to a coarse RGB grid, count bins covering >=1% of pixels.
  const quantized = new cv.Mat();
  const rgbOnly = new cv.Mat();
  cv.cvtColor(finalResultRgba, rgbOnly, cv.COLOR_RGBA2RGB);
  rgbOnly.convertTo(quantized, cv.CV_8UC3, 1, 0);
  const bins = new Map<string, number>();
  const totalPixels = quantized.rows * quantized.cols;
  const step = 4; // sample every 4th pixel for speed — still statistically representative
  for (let y = 0; y < quantized.rows; y += step) {
    for (let x = 0; x < quantized.cols; x += step) {
      const p = quantized.ucharPtr(y, x);
      const key = `${Math.floor(p[0] / 24)},${Math.floor(p[1] / 24)},${Math.floor(p[2] / 24)}`;
      bins.set(key, (bins.get(key) ?? 0) + 1);
    }
  }
  const sampledTotal = Array.from(bins.values()).reduce((a, b) => a + b, 0);
  const dominantBins = Array.from(bins.entries())
    .map(([key, count]) => ({ key, fraction: count / sampledTotal }))
    .filter((b) => b.fraction >= 0.01)
    .sort((a, b) => b.fraction - a.fraction);
  rgbOnly.delete();
  quantized.delete();

  // Gray-dominant %: low saturation (<25/255) pixels as a fraction of the total.
  const lowSatMask = new cv.Mat();
  cv.threshold(satChannel, lowSatMask, 25, 255, cv.THRESH_BINARY_INV);
  const grayFraction = cv.countNonZero(lowSatMask) / totalPixels;
  lowSatMask.delete();

  // Texture diversity proxy: Laplacian variance (higher = more edge/texture detail, lower = flat/smooth fill).
  const gray2 = new cv.Mat();
  cv.cvtColor(finalResultRgba, gray2, cv.COLOR_RGBA2GRAY);
  const laplacian = new cv.Mat();
  cv.Laplacian(gray2, laplacian, cv.CV_64F);
  const lapMean = new cv.Mat();
  const lapStdDev = new cv.Mat();
  cv.meanStdDev(laplacian, lapMean, lapStdDev);
  const laplacianVariance = Math.pow(lapStdDev.data64F[0], 2);
  gray2.delete();
  laplacian.delete();
  lapMean.delete();
  lapStdDev.delete();

  // % of furniture pixels unchanged vs. original (per replaceable-final object).
  let unchangedObjectCount = 0;
  let humanizedObjectCount = 0;
  for (const obj of combined.objects as FinalOpenAIObject[]) {
    const m = rasterize(cv, obj, width, height);
    const area = cv.countNonZero(m);
    if (area === 0) {
      m.delete();
      continue;
    }
    const diff = new cv.Mat();
    cv.absdiff(originalRgba, finalResultRgba, diff);
    const grayDiff = new cv.Mat();
    cv.cvtColor(diff, grayDiff, cv.COLOR_RGBA2GRAY);
    diff.delete();
    const maskedDiff = new cv.Mat();
    cv.bitwise_and(grayDiff, grayDiff, maskedDiff, m);
    grayDiff.delete();
    const meanDiff = cv.mean(maskedDiff, m)[0];
    maskedDiff.delete();
    m.delete();
    if (meanDiff < 6) unchangedObjectCount++;
    else humanizedObjectCount++;
  }

  // % of the editable (fillMask) area that actually changed meaningfully.
  const diffWhole = new cv.Mat();
  cv.absdiff(originalRgba, finalResultRgba, diffWhole);
  const diffWholeGray = new cv.Mat();
  cv.cvtColor(diffWhole, diffWholeGray, cv.COLOR_RGBA2GRAY);
  diffWhole.delete();
  const changedMask = new cv.Mat();
  cv.threshold(diffWholeGray, changedMask, 15, 255, cv.THRESH_BINARY);
  diffWholeGray.delete();
  const changedWithinFill = new cv.Mat();
  cv.bitwise_and(changedMask, fillMask, changedWithinFill);
  changedMask.delete();
  const editableAreaPx = cv.countNonZero(fillMask);
  const humanizedAreaPct = editableAreaPx > 0 ? (cv.countNonZero(changedWithinFill) / editableAreaPx) * 100 : 0;
  changedWithinFill.delete();

  const visualMetrics = {
    dominantColorBinsCount: dominantBins.length,
    dominantColorBins: dominantBins.slice(0, 10),
    averageSaturation0to255: Number(meanSat.toFixed(1)),
    averageSaturationPct: Number(((meanSat / 255) * 100).toFixed(1)),
    laplacianVarianceTextureProxy: Number(laplacianVariance.toFixed(1)),
    grayDominantPct: Number((grayFraction * 100).toFixed(1)),
    furnitureObjectsUnchangedVsOriginal: unchangedObjectCount,
    furnitureObjectsVisiblyHumanized: humanizedObjectCount,
    furnitureUnchangedPct: Number(((unchangedObjectCount / (unchangedObjectCount + humanizedObjectCount || 1)) * 100).toFixed(1)),
    editableAreaHumanizedPct: Number(humanizedAreaPct.toFixed(1)),
  };
  fs.writeFileSync(path.join(AUDIT_DIR, '11-metricas-visuais.json'), JSON.stringify(visualMetrics, null, 2));

  satChannel.delete();
  valChannel.delete();
  hsvChannels.delete();
  hsvConverted.delete();

  // --- Diagnostic-only visual quality gate (requirement #6) — NOT wired into the live pipeline, thresholds provisional/undtuned (requirement #7) ---
  const qualityFlags = {
    provisionalThresholds_NAO_CALIBRADOS: true,
    preenchimentoQuaseMonocromatico: visualMetrics.dominantColorBinsCount <= 3,
    ausenciaDeMateriais: visualMetrics.laplacianVarianceTextureProxy < 50,
    moveisTecnicosNaoHumanizados: visualMetrics.furnitureUnchangedPct > 70,
    excessoDeAreasCinzas: visualMetrics.grayDominantPct > 50,
    saturacaoMuitoBaixa_indicativoDeHalo: visualMetrics.averageSaturationPct < 10,
    resultadoPareceApenasColorirEspacosVazios: visualMetrics.editableAreaHumanizedPct < 15,
  };
  const anyFlagTriggered = Object.entries(qualityFlags).some(([k, v]) => k !== 'provisionalThresholds_NAO_CALIBRADOS' && v === true);
  fs.writeFileSync(path.join(AUDIT_DIR, '12-validacao-qualidade-visual-DIAGNOSTICO.json'), JSON.stringify({ ...qualityFlags, wouldRejectIfWiredLive: anyFlagTriggered, aviso: 'Diagnóstico apenas — esta checagem NÃO está conectada ao pipeline real. Limiares ainda não calibrados/ajustados, conforme instruído.' }, null, 2));

  console.log('=== Métricas visuais ===');
  console.log(JSON.stringify(visualMetrics, null, 2));
  console.log('\n=== Sinalizadores de qualidade (diagnóstico, não ativo) ===');
  console.log(JSON.stringify(qualityFlags, null, 2));
  console.log(`\nallSafelyCorrected... audit saved to: ${AUDIT_DIR}`);

  // cleanup
  originalRgba.delete();
  finalResultRgba.delete();
  protectedMask.delete();
  fillMask.delete();
  wallsMaskOrig.delete();
  cvFurnitureMaskOrig.delete();
  textMaskOrig.delete();
  archesMaskOrig.delete();
  doorsArchesStairsMask.delete();
  substitutableMask.delete();
  nonSubstitutableMask.delete();
  stairsMask.delete();
  floorMask.delete();
  combined.rawFurnitureMask.delete();
  combined.structureSubtractedMask.delete();
}

main().catch((err) => {
  console.error('Audit phase 2 crashed:', err);
  process.exit(1);
});
