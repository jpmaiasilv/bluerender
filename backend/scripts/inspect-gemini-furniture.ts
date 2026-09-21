/**
 * One-off inspection tool for the Gemini semantic furniture/room-detection
 * step of Planta Humanizada. This is the ONLY script authorized to make a
 * real call to Gemini in this round of work, and only against the real
 * test floor plan (backend/test-fixtures/floorplans/planta-tecnica-real-01.jpg).
 *
 * Two-phase pipeline (see src/lib/floorplanFurniture/detectFloorplanFurniture.ts
 * and src/providers/geminiVision.ts): one "overview" call (boxes only) must
 * succeed before "tile-1"/"tile-2" (boxes + segmentation polygon) are ever
 * attempted. At most 3 requests total. No tile is retried automatically; a
 * failing tile does not discard whatever already succeeded.
 *
 * Explicitly does NOT call FLUX.1 Fill, FLUX.2, or any other generation
 * provider. Does NOT touch the credit wallet (no debit(), no job created).
 * Makes NO automatic retry and NO fallback to a different/paid model — a
 * failure here just stops and reports, per the authorization's own terms.
 *
 * Run with: npm run inspect:floorplan-furniture -w backend
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

// Same resolution strategy as src/index.ts — load backend/.env by file
// location, not process.cwd(), so GEMINI_API_KEY is available whether this
// script is run via `npm run` or directly with tsx from any directory.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import { getOpenCv, OpenCv } from '../src/lib/floorplanMask/opencvRuntime';
import { encodeMatToPng } from '../src/lib/floorplanMask/imageIO';
import { detectImageMimeType } from '../src/lib/fileSignature';
import { detectFloorplanFurniture } from '../src/lib/floorplanFurniture/detectFloorplanFurniture';
import { FurnitureDetection } from '../src/lib/floorplanFurniture/types';
import {
  GEMINI_OVERVIEW_JSON_SCHEMA,
  GEMINI_TILE_JSON_SCHEMA,
  GeminiOverviewResponseSchema,
  GeminiTileResponseSchema,
} from '../src/lib/floorplanFurniture/geminiResponseSchema';
import { GEMINI_VISION_MODEL, GEMINI_VISION_THINKING_LEVEL, GEMINI_VISION_TIMEOUT_MS } from '../src/config/geminiVisionEngine';

/**
 * Local, offline self-check of BOTH request schemas — run unconditionally
 * right before the overview call, per requirement #4 ("Valide localmente o
 * JSON Schema atualizado antes do envio"). Checks: (a) no field anywhere in
 * either schema uses JSON-Schema-2020-12's array-form "type" (the cause of
 * the very first call's HTTP 400); (b) a synthetic, obviously-valid sample
 * object round-trips through each Zod response schema, so a typo that
 * desynced a hand-written JSON Schema from its Zod twin would be caught
 * here, offline, before spending a call.
 */
function assertLocalSchemaIsValid(): void {
  function walkForArrayType(node: unknown, pathStr: string): void {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walkForArrayType(item, `${pathStr}[${i}]`));
      return;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if ('type' in obj && Array.isArray(obj.type)) {
        throw new Error(`Local schema self-check failed at ${pathStr}.type: array-form type ${JSON.stringify(obj.type)} is not valid for Gemini's structured-output schema.`);
      }
      for (const [key, value] of Object.entries(obj)) walkForArrayType(value, `${pathStr}.${key}`);
    }
  }
  walkForArrayType(GEMINI_OVERVIEW_JSON_SCHEMA, 'overviewSchema');
  walkForArrayType(GEMINI_TILE_JSON_SCHEMA, 'tileSchema');

  const overviewSample = {
    objects: [{ category: 'cama', label: 'cama de casal (self-check)', roomType: 'quarto', confidence: 0.9, box_2d: [100, 100, 300, 400] }],
  };
  const overviewResult = GeminiOverviewResponseSchema.safeParse(overviewSample);
  if (!overviewResult.success) {
    throw new Error(`Local schema self-check failed: synthetic overview sample did not validate: ${overviewResult.error.message}`);
  }

  const tileSample = {
    objects: [
      {
        category: 'sofa',
        label: 'sofá (self-check)',
        roomType: 'sala',
        confidence: 0.85,
        box_2d: [10, 10, 100, 200],
        mask: [
          [10, 10],
          [200, 10],
          [200, 100],
          [10, 100],
        ],
      },
    ],
  };
  const tileResult = GeminiTileResponseSchema.safeParse(tileSample);
  if (!tileResult.success) {
    throw new Error(`Local schema self-check failed: synthetic tile sample did not validate: ${tileResult.error.message}`);
  }

  console.log('Validação local dos JSON Schemas (overview + tile): OK (sem "type" em formato array; amostras sintéticas validadas com sucesso).');
}

type Mat = InstanceType<OpenCv['Mat']>;

const INPUT_PATH = path.resolve(__dirname, '../test-fixtures/floorplans/planta-tecnica-real-01.jpg');
const OUTPUT_DIR = path.resolve(__dirname, '../test-output/floorplan-furniture-real-01');

const CATEGORY_COLORS: Record<string, [number, number, number]> = {
  replaceable: [0, 170, 80], // green
  uncertain: [190, 0, 210], // magenta
  comodo: [40, 110, 230], // blue (context only, not editable)
  rejected: [140, 140, 140], // gray
};

async function savePng(mat: Mat, filename: string): Promise<void> {
  const png = await encodeMatToPng(mat);
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), png);
}

function drawDetectionBoxes(cv: OpenCv, base: Mat, detections: FurnitureDetection[]): Mat {
  const layer = new cv.Mat();
  base.copyTo(layer);
  for (const det of detections) {
    const [ymin, xmin, ymax, xmax] = det.boxOriginalPixels;
    const colorKey = det.category === 'comodo' ? 'comodo' : det.replaceable ? 'replaceable' : det.uncertain ? 'uncertain' : 'rejected';
    const [r, g, b] = CATEGORY_COLORS[colorKey];
    cv.rectangle(layer, new cv.Point(Math.round(xmin), Math.round(ymin)), new cv.Point(Math.round(xmax), Math.round(ymax)), new cv.Scalar(r, g, b, 255), 3);
    const label = `${det.label} (${(det.confidence * 100).toFixed(0)}%)`;
    cv.putText(layer, label, new cv.Point(Math.round(xmin), Math.max(12, Math.round(ymin) - 6)), cv.FONT_HERSHEY_SIMPLEX, 0.42, new cv.Scalar(r, g, b, 255), 1, cv.LINE_AA);
  }
  return layer;
}

function drawDetectionPolygons(cv: OpenCv, base: Mat, detections: FurnitureDetection[]): Mat {
  const layer = new cv.Mat();
  base.copyTo(layer);
  for (const det of detections) {
    const colorKey = det.category === 'comodo' ? 'comodo' : det.replaceable ? 'replaceable' : det.uncertain ? 'uncertain' : 'rejected';
    const [r, g, b] = CATEGORY_COLORS[colorKey];
    if (det.polygonOriginalPixels && det.polygonOriginalPixels.length >= 3) {
      const flat = det.polygonOriginalPixels.flatMap(([x, y]) => [Math.round(x), Math.round(y)]);
      const contour = cv.matFromArray(det.polygonOriginalPixels.length, 1, cv.CV_32SC2, flat);
      const contours = new cv.MatVector();
      contours.push_back(contour);
      cv.drawContours(layer, contours, 0, new cv.Scalar(r, g, b, 255), 3);
      contour.delete();
      contours.delete();
    } else {
      const [ymin, xmin, ymax, xmax] = det.boxOriginalPixels;
      cv.rectangle(layer, new cv.Point(Math.round(xmin), Math.round(ymin)), new cv.Point(Math.round(xmax), Math.round(ymax)), new cv.Scalar(r, g, b, 255), 1);
    }
  }
  return layer;
}

function paintMaskColor(cv: OpenCv, layer: Mat, mask: Mat, color: [number, number, number]): void {
  layer.setTo(new cv.Scalar(color[0], color[1], color[2], 255), mask);
}

/** Defense in depth: even though nothing in this pipeline is expected to ever echo the key back, strip anything that happens to match its exact value before it can reach the console or a file. */
function redactSecrets(text: string): string {
  const key = process.env.GEMINI_API_KEY;
  if (key && key.length > 8) {
    return text.split(key).join('[REDACTED]');
  }
  return text;
}

async function main() {
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`Arquivo não encontrado em: ${INPUT_PATH}`);
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY não está configurada em backend/.env — interrompendo (Free Tier indisponível sem chave).');
    process.exit(1);
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const cv = await getOpenCv();
  const imageBuffer = fs.readFileSync(INPUT_PATH);
  const detectedMime = detectImageMimeType(imageBuffer);

  console.log(`Modelo Gemini: ${GEMINI_VISION_MODEL} (Free Tier — nenhuma configuração de billing/Vertex é usada; ver config/geminiVisionEngine.ts).`);
  console.log(`thinking_level: ${GEMINI_VISION_THINKING_LEVEL} | timeout: ${GEMINI_VISION_TIMEOUT_MS}ms`);
  console.log(`Planta de teste: ${INPUT_PATH}`);
  assertLocalSchemaIsValid();
  console.log('\nExecutando detecção (overview -> tile-1 -> tile-2, no máximo 3 requisições; overview deve ter sucesso antes de qualquer tile)...\n');

  const { report, artifacts } = await detectFloorplanFurniture(imageBuffer, {
    onOverviewSuccess: async ({ rawOutputText, elapsedMs, detectionCount }) => {
      // Saved IMMEDIATELY, before any tile is attempted — survives even if
      // a later tile fails (requirement: "salve imediatamente seu JSON
      // sanitizado antes de iniciar os tiles").
      const overviewJson = {
        elapsedMs,
        detectionCount,
        sanitizedOutputText: redactSecrets(rawOutputText),
      };
      fs.writeFileSync(path.join(OUTPUT_DIR, '00-overview-resultado.json'), JSON.stringify(overviewJson, null, 2));
      console.log(`  overview OK em ${elapsedMs}ms, ${detectionCount} objeto(s) — salvo em 00-overview-resultado.json`);
    },
  });

  // 1) Original
  await savePng(artifacts.originalRgba, '01-original.png');

  // 2) Useful area — original with the detected useful-area rectangle drawn.
  const usefulAreaViz = new cv.Mat();
  artifacts.originalRgba.copyTo(usefulAreaViz);
  cv.rectangle(
    usefulAreaViz,
    new cv.Point(report.usefulArea.x, report.usefulArea.y),
    new cv.Point(report.usefulArea.x + report.usefulArea.width, report.usefulArea.y + report.usefulArea.height),
    new cv.Scalar(230, 30, 30, 255),
    4
  );
  await savePng(usefulAreaViz, '02-area-util-detectada.png');
  usefulAreaViz.delete();

  // 3) Overview sent to Gemini
  fs.writeFileSync(path.join(OUTPUT_DIR, '03-visao-geral-enviada.png'), artifacts.overviewCropBuffer);

  // 4) Tiles sent to Gemini (only the ones actually extracted/attempted)
  artifacts.tileCropBuffers.forEach((buf, i) => {
    fs.writeFileSync(path.join(OUTPUT_DIR, `04-recorte-${i + 1}-enviado.png`), buf);
  });

  // 5) Boxes
  const boxesViz = drawDetectionBoxes(cv, artifacts.originalRgba, report.detections);
  await savePng(boxesViz, '05-objetos-caixas.png');
  boxesViz.delete();

  // 6) Polygons
  const polygonsViz = drawDetectionPolygons(cv, artifacts.originalRgba, report.detections);
  await savePng(polygonsViz, '06-objetos-poligonos.png');
  polygonsViz.delete();

  // 7) Legend (text file — category, confidence, room per object)
  const legendLines = report.detections.map(
    (d) => `${d.id}\t${d.category}\t${d.label}\troomType=${d.roomType ?? '—'}\tconfidence=${d.confidence.toFixed(2)}\treplaceable=${d.replaceable}\tuncertain=${d.uncertain}\treason=${d.reason}`
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, '07-legenda.txt'),
    ['id\tcategory\tlabel\troomType\tconfidence\treplaceable\tuncertain\treason', ...legendLines].join('\n')
  );

  // 8) Raw furniture mask (union of all candidates, before structure subtraction)
  await savePng(artifacts.rawFurnitureMask, '08-mascara-bruta-moveis.png');

  // 9) Furniture mask after subtracting structure
  await savePng(artifacts.structureSubtractedMask, '09-mascara-moveis-pos-estrutura.png');

  // 10) Final combined overlay: protected structure, confirmed furniture, uncertain objects, editable left plain.
  const finalOverlay = new cv.Mat();
  artifacts.originalRgba.copyTo(finalOverlay);
  paintMaskColor(cv, finalOverlay, artifacts.structuralProtectedMask, [190, 40, 40]);
  const confirmedMaskOnly = new cv.Mat();
  const uncertainMaskOnly = new cv.Mat();
  {
    // Rebuild per-category masks for coloring from the already-subtracted furniture mask + detection list.
    const width = report.originalWidth;
    const height = report.originalHeight;
    const confirmed = cv.Mat.zeros(height, width, cv.CV_8UC1);
    const uncertain = cv.Mat.zeros(height, width, cv.CV_8UC1);
    for (const det of report.detections) {
      if (det.category === 'comodo') continue;
      if (!det.replaceable && !det.uncertain) continue;
      const target = det.replaceable ? confirmed : uncertain;
      if (det.polygonOriginalPixels && det.polygonOriginalPixels.length >= 3) {
        const flat = det.polygonOriginalPixels.flatMap(([x, y]) => [Math.round(x), Math.round(y)]);
        const contour = cv.matFromArray(det.polygonOriginalPixels.length, 1, cv.CV_32SC2, flat);
        const contours = new cv.MatVector();
        contours.push_back(contour);
        cv.drawContours(target, contours, 0, new cv.Scalar(255), -1);
        contour.delete();
        contours.delete();
      } else {
        const [ymin, xmin, ymax, xmax] = det.boxOriginalPixels;
        cv.rectangle(target, new cv.Point(Math.round(xmin), Math.round(ymin)), new cv.Point(Math.round(xmax), Math.round(ymax)), new cv.Scalar(255), -1);
      }
    }
    confirmed.copyTo(confirmedMaskOnly);
    uncertain.copyTo(uncertainMaskOnly);
    confirmed.delete();
    uncertain.delete();
  }
  paintMaskColor(cv, finalOverlay, confirmedMaskOnly, CATEGORY_COLORS.replaceable);
  paintMaskColor(cv, finalOverlay, uncertainMaskOnly, CATEGORY_COLORS.uncertain);
  await savePng(finalOverlay, '10-sobreposicao-final.png');
  finalOverlay.delete();
  confirmedMaskOnly.delete();
  uncertainMaskOnly.delete();

  // 11) Full JSON analysis
  const fullJson = {
    model: report.model,
    thinkingLevel: report.thinkingLevel,
    geminiCallCount: report.geminiCallCount,
    totalTimeMs: report.totalTimeMs,
    callOutcomes: report.callOutcomes,
    originalWidth: report.originalWidth,
    originalHeight: report.originalHeight,
    usefulArea: report.usefulArea,
    crops: report.crops,
    detections: report.detections,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, '11-analise-completa.json'), JSON.stringify(fullJson, null, 2));

  // 12) Summary report, including per-request timing
  const byCategory: Record<string, number> = {};
  const rooms: string[] = [];
  let replaceableCount = 0;
  let uncertainCount = 0;
  let rejectedCount = 0;
  for (const d of report.detections) {
    byCategory[d.category] = (byCategory[d.category] || 0) + 1;
    if (d.category === 'comodo') rooms.push(d.label);
    else if (d.replaceable) replaceableCount++;
    else if (d.uncertain) uncertainCount++;
    else rejectedCount++;
  }
  const summary = {
    arquivo: { caminho: INPUT_PATH, formatoDetectado: detectedMime, tamanhoBytes: imageBuffer.length },
    modelo: report.model,
    thinkingLevel: report.thinkingLevel,
    quantidadeChamadasGemini: report.geminiCallCount,
    tempoTotalMs: report.totalTimeMs,
    tempoPorRequisicao: report.callOutcomes.map((o) => ({ cropId: o.cropId, variant: o.variant, success: o.success, elapsedMs: o.elapsedMs, detectionCount: o.detectionCount, errorMessage: o.errorMessage })),
    dimensoesOriginais: { largura: report.originalWidth, altura: report.originalHeight },
    areaUtil: report.usefulArea,
    recortesEnviados: report.crops.map((c) => ({ id: c.id, rectInOriginal: c.rectInOriginal, sentWidth: c.sentWidth, sentHeight: c.sentHeight })),
    totalObjetosDetectados: report.detections.length,
    objetosPorCategoria: byCategory,
    comodosReconhecidos: rooms,
    moveisConfirmados: replaceableCount,
    moveisIncertos: uncertainCount,
    moveisRejeitados: rejectedCount,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, '12-relatorio-resumido.json'), JSON.stringify(summary, null, 2));

  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nArquivos salvos em: ${OUTPUT_DIR}`);
  console.log('Nenhuma chamada à BFL/FLUX foi feita. Nenhum crédito foi descontado.');

  artifacts.originalRgba.delete();
  artifacts.usefulAreaRgba.delete();
  artifacts.structuralProtectedMask.delete();
  artifacts.rawFurnitureMask.delete();
  artifacts.structureSubtractedMask.delete();
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  const details = err && typeof err === 'object' && 'details' in err ? String((err as { details?: unknown }).details ?? '') : '';
  const httpStatus = err && typeof err === 'object' && 'httpStatus' in err ? (err as { httpStatus?: unknown }).httpStatus : undefined;
  const context = err && typeof err === 'object' ? (err as { geminiCallContext?: unknown }).geminiCallContext : undefined;
  const partialOutcomes = err && typeof err === 'object' ? (err as { partialCallOutcomes?: unknown }).partialCallOutcomes : undefined;

  console.error('\n=== FALHA NA INSPEÇÃO ===');
  console.error('Status HTTP:', httpStatus ?? 'n/a (falha antes de uma resposta HTTP, ou erro local)');
  console.error('Mensagem:', redactSecrets(message));
  if (details) console.error('Corpo do erro (sanitizado):', redactSecrets(details));
  if (context) {
    console.error('Etapa exata da falha (recorte sendo enviado):', JSON.stringify(context, null, 2));
  } else {
    console.error('Etapa exata da falha: antes do envio a um recorte específico (ex.: validação local do schema, ou decodificação da imagem).');
  }
  if (partialOutcomes) {
    console.error('Resultados parciais preservados:', JSON.stringify(partialOutcomes, null, 2));
  }
  console.error('=========================\n');

  // process.exitCode (not process.exit()) lets Node finish draining pending
  // I/O/timers naturally — calling process.exit() here was observed to hit
  // a libuv assertion crash (UV_HANDLE_CLOSING) on Windows while the
  // OpenCV WASM runtime / SDK HTTP client still had handles open.
  process.exitCode = 1;
});
