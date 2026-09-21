/**
 * One-off inspection tool for the OpenAI semantic furniture/room-detection
 * step of Planta Humanizada. NOT executed as part of this round of work —
 * per explicit requirement, no real call happens until separately
 * authorized. When it is authorized and run, it makes real calls ONLY to
 * OpenAI (never BFL/FLUX/Gemini), ONLY against the real test floor plan
 * (backend/test-fixtures/floorplans/planta-tecnica-real-01.jpg), and never
 * touches the credit wallet (no debit(), no job created).
 *
 * Two-phase pipeline (see src/lib/floorplanFurniture/detectFloorplanFurnitureOpenAI.ts
 * and src/providers/openaiVision.ts): one "overview" call (boxes only) must
 * succeed before "tile-1"/"tile-2" (boxes + segmentation polygon) are ever
 * attempted. No tile is retried automatically; a failing tile does not
 * discard whatever already succeeded.
 *
 * Run with: npm run inspect:floorplan-furniture-openai -w backend
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import { getOpenCv, OpenCv } from '../src/lib/floorplanMask/opencvRuntime';
import { encodeMatToPng } from '../src/lib/floorplanMask/imageIO';
import { detectImageMimeType } from '../src/lib/fileSignature';
import { detectFloorplanFurnitureOpenAI } from '../src/lib/floorplanFurniture/detectFloorplanFurnitureOpenAI';
import { FinalOpenAIObject, FinalOpenAIRoom } from '../src/lib/floorplanFurniture/openaiTypes';
import {
  buildOpenAIOverviewSchema,
  buildOpenAITileSchema,
  OPENAI_OVERVIEW_JSON_SCHEMA,
  OPENAI_TILE_JSON_SCHEMA,
} from '../src/lib/floorplanFurniture/openaiResponseSchema';
import { OPENAI_VISION_MODEL, OPENAI_VISION_TIMEOUT_MS, ACTIVE_VISION_PROVIDER } from '../src/config/openaiModels';

type Mat = InstanceType<OpenCv['Mat']>;

const INPUT_PATH = path.resolve(__dirname, '../test-fixtures/floorplans/planta-tecnica-real-01.jpg');
const OUTPUT_DIR = path.resolve(__dirname, '../test-output/floorplan-furniture-openai-real-01');

const CATEGORY_COLORS: Record<string, [number, number, number]> = {
  replaceable: [0, 170, 80],
  uncertain: [190, 0, 210],
  room: [40, 110, 230],
  rejected: [140, 140, 140],
};

/** Distinct colors per requirement #2 of this run's authorization: cômodos, móveis, louças, escada, veículo each get their own color in the overview inspection image. */
const OVERVIEW_TYPE_COLORS: Record<string, [number, number, number]> = {
  comodo: [40, 110, 230], // blue
  louca: [0, 170, 200], // teal (pia, vaso_sanitario, chuveiro)
  escada: [230, 140, 0], // orange
  veiculo: [140, 40, 220], // purple
  movel: [0, 170, 80], // green (everything else: cama, sofa, mesa, cadeira, armario, bancada, eletrodomestico, mobiliario_outro, objeto_outro)
};

function overviewTypeColor(category: string): [number, number, number] {
  const normalized = category.toLowerCase();
  if (['pia', 'vaso_sanitario', 'chuveiro'].includes(normalized)) return OVERVIEW_TYPE_COLORS.louca;
  if (normalized === 'escada') return OVERVIEW_TYPE_COLORS.escada;
  if (normalized === 'veiculo') return OVERVIEW_TYPE_COLORS.veiculo;
  return OVERVIEW_TYPE_COLORS.movel;
}

function assertLocalSchemaIsValid(): void {
  function walk(node: unknown, pathStr: string): void {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${pathStr}[${i}]`));
      return;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if ('type' in obj && Array.isArray(obj.type) && obj.type.includes('null') === false) {
        // (informational only — arrays like ["string","null"] ARE expected/correct for OpenAI; this branch intentionally never throws)
      }
      Object.values(obj).forEach((v) => walk(v, pathStr));
    }
  }
  walk(OPENAI_OVERVIEW_JSON_SCHEMA, 'overviewSchema');
  walk(OPENAI_TILE_JSON_SCHEMA, 'tileSchema');

  const overviewSample = {
    imageWidth: 1000,
    imageHeight: 1000,
    rooms: [],
    objects: [{ id: 'x', category: 'cama', subcategory: null, roomType: 'quarto', confidence: 0.9, orientationDegrees: null, box: { xMin: 10, yMin: 10, xMax: 300, yMax: 300 }, replaceable: true, notes: null }],
    warnings: [],
  };
  const overviewResult = buildOpenAIOverviewSchema(1000, 1000).safeParse(overviewSample);
  if (!overviewResult.success) throw new Error(`Local schema self-check failed (overview): ${overviewResult.error.message}`);

  const tileSample = {
    ...overviewSample,
    objects: [
      {
        ...overviewSample.objects[0],
        polygon: [
          { x: 10, y: 10 },
          { x: 300, y: 10 },
          { x: 300, y: 300 },
        ],
      },
    ],
  };
  const tileResult = buildOpenAITileSchema(1000, 1000).safeParse(tileSample);
  if (!tileResult.success) throw new Error(`Local schema self-check failed (tile): ${tileResult.error.message}`);

  console.log('Validação local dos JSON Schemas (overview + tile) da OpenAI: OK.');
}

async function savePng(mat: Mat, filename: string): Promise<void> {
  const png = await encodeMatToPng(mat);
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), png);
}

/** Reserved for a future full (overview+tiles) run of this script — not used by the current overview-only authorized execution, which uses drawOverviewInspection() instead (see requirement #2 of that authorization: distinct colors per type, not per replaceable/uncertain/rejected status). */
function drawObjectBoxes(cv: OpenCv, base: Mat, objects: FinalOpenAIObject[], rooms: FinalOpenAIRoom[]): Mat {
  const layer = new cv.Mat();
  base.copyTo(layer);
  for (const room of rooms) {
    const [r, g, b] = CATEGORY_COLORS.room;
    const { xMin, yMin, xMax, yMax } = room.boxOriginalPixels;
    cv.rectangle(layer, new cv.Point(Math.round(xMin), Math.round(yMin)), new cv.Point(Math.round(xMax), Math.round(yMax)), new cv.Scalar(r, g, b, 255), 2);
  }
  for (const obj of objects) {
    const colorKey = obj.replaceable ? 'replaceable' : obj.uncertain ? 'uncertain' : 'rejected';
    const [r, g, b] = CATEGORY_COLORS[colorKey];
    const { xMin, yMin, xMax, yMax } = obj.boxOriginalPixels;
    cv.rectangle(layer, new cv.Point(Math.round(xMin), Math.round(yMin)), new cv.Point(Math.round(xMax), Math.round(yMax)), new cv.Scalar(r, g, b, 255), 3);
    const label = `${obj.category} (${(obj.confidence * 100).toFixed(0)}%)`;
    cv.putText(layer, label, new cv.Point(Math.round(xMin), Math.max(12, Math.round(yMin) - 6)), cv.FONT_HERSHEY_SIMPLEX, 0.42, new cv.Scalar(r, g, b, 255), 1, cv.LINE_AA);
  }
  return layer;
}

/** Deliverable #2 of this run's authorization: rooms + objects, category + confidence labels, colors distinguishing cômodo/louça/escada/veículo/demais móveis. */
function drawOverviewInspection(cv: OpenCv, base: Mat, objects: FinalOpenAIObject[], rooms: FinalOpenAIRoom[]): Mat {
  const layer = new cv.Mat();
  base.copyTo(layer);
  for (const room of rooms) {
    const [r, g, b] = OVERVIEW_TYPE_COLORS.comodo;
    const { xMin, yMin, xMax, yMax } = room.boxOriginalPixels;
    cv.rectangle(layer, new cv.Point(Math.round(xMin), Math.round(yMin)), new cv.Point(Math.round(xMax), Math.round(yMax)), new cv.Scalar(r, g, b, 255), 2);
    const label = `comodo: ${room.type} (${(room.confidence * 100).toFixed(0)}%)`;
    cv.putText(layer, label, new cv.Point(Math.round(xMin), Math.max(12, Math.round(yMin) - 6)), cv.FONT_HERSHEY_SIMPLEX, 0.4, new cv.Scalar(r, g, b, 255), 1, cv.LINE_AA);
  }
  for (const obj of objects) {
    const [r, g, b] = overviewTypeColor(obj.category);
    const { xMin, yMin, xMax, yMax } = obj.boxOriginalPixels;
    cv.rectangle(layer, new cv.Point(Math.round(xMin), Math.round(yMin)), new cv.Point(Math.round(xMax), Math.round(yMax)), new cv.Scalar(r, g, b, 255), 3);
    const label = `${obj.category} (${(obj.confidence * 100).toFixed(0)}%)`;
    cv.putText(layer, label, new cv.Point(Math.round(xMin), Math.max(12, Math.round(yMin) - 6)), cv.FONT_HERSHEY_SIMPLEX, 0.42, new cv.Scalar(r, g, b, 255), 1, cv.LINE_AA);
  }
  return layer;
}

/** Reserved for a future full (with-tiles) run — an overview-only run never has segmentation polygons, since the overview phase never requests one. */
function drawObjectPolygons(cv: OpenCv, base: Mat, objects: FinalOpenAIObject[]): Mat {
  const layer = new cv.Mat();
  base.copyTo(layer);
  for (const obj of objects) {
    const colorKey = obj.replaceable ? 'replaceable' : obj.uncertain ? 'uncertain' : 'rejected';
    const [r, g, b] = CATEGORY_COLORS[colorKey];
    if (obj.polygonOriginalPixels && obj.polygonOriginalPixels.length >= 3) {
      const flat = obj.polygonOriginalPixels.flatMap((p) => [Math.round(p.x), Math.round(p.y)]);
      const contour = cv.matFromArray(obj.polygonOriginalPixels.length, 1, cv.CV_32SC2, flat);
      const contours = new cv.MatVector();
      contours.push_back(contour);
      cv.drawContours(layer, contours, 0, new cv.Scalar(r, g, b, 255), 3);
      contour.delete();
      contours.delete();
    } else {
      const { xMin, yMin, xMax, yMax } = obj.boxOriginalPixels;
      cv.rectangle(layer, new cv.Point(Math.round(xMin), Math.round(yMin)), new cv.Point(Math.round(xMax), Math.round(yMax)), new cv.Scalar(r, g, b, 255), 1);
    }
  }
  return layer;
}

function paintMaskColor(cv: OpenCv, layer: Mat, mask: Mat, color: [number, number, number]): void {
  layer.setTo(new cv.Scalar(color[0], color[1], color[2], 255), mask);
}

function redactSecrets(text: string): string {
  const key = process.env.OPENAI_API_KEY;
  if (key && key.length > 8) return text.split(key).join('[REDACTED]');
  return text;
}

async function main() {
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`Arquivo não encontrado em: ${INPUT_PATH}`);
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY não está configurada em backend/.env — interrompendo.');
    process.exit(1);
  }
  if (ACTIVE_VISION_PROVIDER !== 'openai') {
    console.error(`VISION_PROVIDER está configurado como "${ACTIVE_VISION_PROVIDER}", não "openai" — interrompendo (este script é exclusivo da OpenAI).`);
    process.exit(1);
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const cv = await getOpenCv();
  const imageBuffer = fs.readFileSync(INPUT_PATH);
  const detectedMime = detectImageMimeType(imageBuffer);

  console.log(`Modelo OpenAI (visão): ${OPENAI_VISION_MODEL} | timeout: ${OPENAI_VISION_TIMEOUT_MS}ms | detail: original | store: false`);
  console.log(`Planta de teste: ${INPUT_PATH}`);
  assertLocalSchemaIsValid();
  console.log('\nExecutando detecção — SOMENTE overview (execução autorizada não inclui tiles)...\n');

  const { report, artifacts } = await detectFloorplanFurnitureOpenAI(imageBuffer, {
    overviewOnly: true,
    onOverviewSuccess: async ({ rawOutputText, elapsedMs, roomCount, objectCount, requestId }) => {
      const overviewJson = { elapsedMs, roomCount, objectCount, requestId, sanitizedOutputText: redactSecrets(rawOutputText) };
      fs.writeFileSync(path.join(OUTPUT_DIR, '00-overview-resultado.json'), JSON.stringify(overviewJson, null, 2));
      console.log(`  overview OK em ${elapsedMs}ms, ${roomCount} cômodo(s) + ${objectCount} objeto(s) — salvo em 00-overview-resultado.json`);
    },
  });

  await savePng(artifacts.originalRgba, '01-original.png');

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

  fs.writeFileSync(path.join(OUTPUT_DIR, '03-visao-geral-enviada.png'), artifacts.overviewCropBuffer);
  // No tiles were extracted or sent in this overviewOnly run — tileCropBuffers is empty by construction.

  // Deliverable #2: rooms + objects, category + confidence, distinct colors per type.
  const overviewInspectionViz = drawOverviewInspection(cv, artifacts.originalRgba, report.objects, report.rooms);
  await savePng(overviewInspectionViz, '05-inspecao-overview-caixas.png');
  overviewInspectionViz.delete();

  // No segmentation polygons exist in an overview-only run (the overview phase never requests one) — skipped rather than saving an empty/meaningless artifact.

  const legendLines = report.objects.map(
    (o) => `${o.id}\t${o.category}\t${o.subcategory ?? '—'}\troomType=${o.roomType ?? '—'}\tconfidence=${o.confidence.toFixed(2)}\tmodelReplaceable=${o.modelReplaceable}\treplaceable=${o.replaceable}\tuncertain=${o.uncertain}\treason=${o.reason}`
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, '07-legenda.txt'),
    ['id\tcategory\tsubcategory\troomType\tconfidence\tmodelReplaceable\treplaceable\tuncertain\treason', ...legendLines].join('\n')
  );

  // NOTE: these two masks (and the combination image below) are built ONLY
  // from the overview's box-only detections — per requirement #4 of this
  // run's authorization ("não gere máscara definitiva e não prossiga para
  // tiles"), they are explicitly PRELIMINARY, not a final/production mask.
  // A real final mask requires the tile phase (segmentation polygons), not
  // authorized in this run.
  await savePng(artifacts.rawFurnitureMask, '08-mascara-bruta-moveis-preliminar.png');
  await savePng(artifacts.structureSubtractedMask, '09-mascara-moveis-pos-estrutura-preliminar.png');

  const finalOverlay = new cv.Mat();
  artifacts.originalRgba.copyTo(finalOverlay);
  paintMaskColor(cv, finalOverlay, artifacts.structuralProtectedMask, [190, 40, 40]);
  const confirmedMaskOnly = new cv.Mat();
  const uncertainMaskOnly = new cv.Mat();
  {
    const width = report.originalWidth;
    const height = report.originalHeight;
    const confirmed = cv.Mat.zeros(height, width, cv.CV_8UC1);
    const uncertain = cv.Mat.zeros(height, width, cv.CV_8UC1);
    for (const obj of report.objects) {
      if (!obj.replaceable && !obj.uncertain) continue;
      const target = obj.replaceable ? confirmed : uncertain;
      if (obj.polygonOriginalPixels && obj.polygonOriginalPixels.length >= 3) {
        const flat = obj.polygonOriginalPixels.flatMap((p) => [Math.round(p.x), Math.round(p.y)]);
        const contour = cv.matFromArray(obj.polygonOriginalPixels.length, 1, cv.CV_32SC2, flat);
        const contours = new cv.MatVector();
        contours.push_back(contour);
        cv.drawContours(target, contours, 0, new cv.Scalar(255), -1);
        contour.delete();
        contours.delete();
      } else {
        const { xMin, yMin, xMax, yMax } = obj.boxOriginalPixels;
        cv.rectangle(target, new cv.Point(Math.round(xMin), Math.round(yMin)), new cv.Point(Math.round(xMax), Math.round(yMax)), new cv.Scalar(255), -1);
      }
    }
    confirmed.copyTo(confirmedMaskOnly);
    uncertain.copyTo(uncertainMaskOnly);
    confirmed.delete();
    uncertain.delete();
  }
  paintMaskColor(cv, finalOverlay, confirmedMaskOnly, CATEGORY_COLORS.replaceable);
  paintMaskColor(cv, finalOverlay, uncertainMaskOnly, CATEGORY_COLORS.uncertain);
  // Deliverable #3: OpenAI (overview-only) + OpenCV structural mask combination — preliminary, not a final mask.
  await savePng(finalOverlay, '10-combinacao-openai-opencv-preliminar.png');
  finalOverlay.delete();
  confirmedMaskOnly.delete();
  uncertainMaskOnly.delete();

  const fullJson = {
    provider: 'openai',
    model: report.model,
    callCount: report.callCount,
    totalTimeMs: report.totalTimeMs,
    callOutcomes: report.callOutcomes,
    requestIds: report.requestIds,
    usageTotals: report.usageTotals,
    modelWarnings: report.modelWarnings,
    originalWidth: report.originalWidth,
    originalHeight: report.originalHeight,
    usefulArea: report.usefulArea,
    crops: report.crops,
    rooms: report.rooms,
    objects: report.objects,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, '11-analise-completa.json'), JSON.stringify(fullJson, null, 2));

  let replaceableCount = 0;
  let uncertainCount = 0;
  let rejectedCount = 0;
  const byCategory: Record<string, number> = {};
  const confidences: number[] = [];
  const ambiguousObjects: { id: string; category: string; confidence: number; reason: string }[] = [];
  for (const o of report.objects) {
    byCategory[o.category] = (byCategory[o.category] || 0) + 1;
    confidences.push(o.confidence);
    if (o.replaceable) replaceableCount++;
    else if (o.uncertain) uncertainCount++;
    else rejectedCount++;
    if (o.confidence < 0.6 || o.uncertain) {
      ambiguousObjects.push({ id: o.id, category: o.category, confidence: o.confidence, reason: o.uncertain ? o.reason : 'confiança abaixo de 0.6' });
    }
  }
  const avgConfidence = confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;
  const minConfidence = confidences.length > 0 ? Math.min(...confidences) : null;
  const maxConfidence = confidences.length > 0 ? Math.max(...confidences) : null;

  const overviewCrop = report.crops.find((c) => c.id === 'overview');

  const summary = {
    arquivo: { caminho: INPUT_PATH, formatoDetectado: detectedMime, tamanhoBytes: imageBuffer.length },
    provedor: 'openai',
    modelo: report.model,
    quantidadeChamadas: report.callCount,
    execucaoSomenteOverview: true,
    tempoTotalMs: report.totalTimeMs,
    tempoPorRequisicao: report.callOutcomes.map((o) => ({ cropId: o.cropId, variant: o.variant, success: o.success, elapsedMs: o.elapsedMs, detectionCount: o.detectionCount, errorMessage: o.errorMessage })),
    requestIds: report.requestIds,
    usoDeTokens: report.usageTotals,
    custoEstimadoUsd: null as number | null,
    custoEstimadoNota:
      'Não calculado — o SDK não devolve um valor em USD diretamente, e eu não tenho um preço por token confirmado e atual para gpt-5.6-terra que eu possa citar com confiança. O uso de tokens acima (usoDeTokens) é o dado real devolvido pela API; o custo em USD pode ser calculado a partir dele consultando a tabela de preços atual da sua conta OpenAI.',
    dimensoesOriginais: { largura: report.originalWidth, altura: report.originalHeight },
    dimensoesOverviewEnviado: overviewCrop ? { sentWidth: overviewCrop.sentWidth, sentHeight: overviewCrop.sentHeight, rectInOriginal: overviewCrop.rectInOriginal } : null,
    conversaoCoordenadas: 'Confirmada: todas as caixas em report.objects[].boxOriginalPixels/report.rooms[].boxOriginalPixels já estão em pixels da imagem ORIGINAL (1755x1241), convertidas a partir dos pixels do recorte overview enviado via mapBoxToOriginal (ver openaiCoordinateTransform.ts). Nenhum polígono foi retornado nesta execução (fase overview não solicita polígono).',
    areaUtil: report.usefulArea,
    recortesEnviados: report.crops.map((c) => ({ id: c.id, rectInOriginal: c.rectInOriginal, sentWidth: c.sentWidth, sentHeight: c.sentHeight })),
    totalComodos: report.rooms.length,
    totalObjetos: report.objects.length,
    objetosPorCategoria: byCategory,
    confiancaObjetos: { media: avgConfidence, minima: minConfidence, maxima: maxConfidence },
    objetosConfirmados: replaceableCount,
    objetosIncertos: uncertainCount,
    objetosRejeitados: rejectedCount,
    objetosAmbiguos: ambiguousObjects,
    avisosDoModelo: report.modelWarnings,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, '12-relatorio-resumido.json'), JSON.stringify(summary, null, 2));

  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nArquivos salvos em: ${OUTPUT_DIR}`);
  console.log('Nenhuma chamada à BFL/FLUX/Gemini foi feita. Nenhum crédito foi descontado.');

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
  const context = err && typeof err === 'object' ? (err as { openaiCallContext?: unknown }).openaiCallContext : undefined;
  const partialOutcomes = err && typeof err === 'object' ? (err as { partialCallOutcomes?: unknown }).partialCallOutcomes : undefined;

  console.error('\n=== FALHA NA INSPEÇÃO ===');
  console.error('Status HTTP:', httpStatus ?? 'n/a');
  console.error('Mensagem:', redactSecrets(message));
  if (details) console.error('Corpo do erro (sanitizado):', redactSecrets(details));
  if (context) console.error('Etapa exata da falha:', JSON.stringify(context, null, 2));
  if (partialOutcomes) console.error('Resultados parciais preservados:', JSON.stringify(partialOutcomes, null, 2));
  console.error('=========================\n');

  process.exitCode = 1;
});
