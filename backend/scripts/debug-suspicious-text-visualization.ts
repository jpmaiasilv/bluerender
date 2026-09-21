/**
 * OFFLINE, read-only debug visualization of the suspicious-text detector
 * (floorplanValidation.ts's detectSuspiciousNewText) — makes NO network
 * call of any kind (no OpenAI, Gemini, BFL, FLUX). Uses ONLY files already
 * on disk from earlier in this session:
 *  - the original test floor plan (frontend/public/images/home/tool-floor-plan.png)
 *  - the one real, saved Fill result from that same original
 *    (backend/public/results/457975cc-98c0-4226-b55e-be569687ba73.png)
 *
 * IMPORTANT CAVEAT: this is NOT the specific job the user saw rejected in
 * the frontend with "53 elementos" — that job's generated image was never
 * written to disk (routes/generateHumanizedFloorplan.ts only ever calls
 * saveResultImage() AFTER validation.accepted is true; a rejected result's
 * Mat is deleted in-memory and never persisted, by design, so it cannot be
 * recovered after the fact). This script instead reproduces the exact same
 * detector, run locally against the one real saved result this project
 * does have on disk, as the closest honest stand-in — see the accompanying
 * report for the actual blob count this produces (which will differ from
 * 53, since it's a different generation).
 *
 * Run with: npx tsx scripts/debug-suspicious-text-visualization.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { getOpenCv, OpenCv } from '../src/lib/floorplanMask/opencvRuntime';
import { decodeToMat, encodeMatToPng } from '../src/lib/floorplanMask/imageIO';
import { buildFloorplanMask } from '../src/lib/floorplanMask/buildMask';
import { detectTextLikeMask } from '../src/lib/floorplanMask/detectStructure';
import { forceOriginalDimensions, overlayOriginalWallLines, detectSuspiciousNewText } from '../src/lib/floorplanMask/floorplanValidation';

type Mat = InstanceType<OpenCv['Mat']>;

const ORIGINAL_PATH = path.resolve(__dirname, '../../frontend/public/images/home/tool-floor-plan.png');
const RESULT_PATH = path.resolve(__dirname, '../public/results/457975cc-98c0-4226-b55e-be569687ba73.png');
const OUTPUT_DIR = path.resolve(__dirname, '../test-output/suspicious-text-debug');

async function main() {
  if (!fs.existsSync(ORIGINAL_PATH) || !fs.existsSync(RESULT_PATH)) {
    console.error('Um dos arquivos necessários não foi encontrado — nenhum arquivo novo será baixado/gerado por chamada de IA.');
    console.error('ORIGINAL_PATH:', ORIGINAL_PATH, fs.existsSync(ORIGINAL_PATH));
    console.error('RESULT_PATH:', RESULT_PATH, fs.existsSync(RESULT_PATH));
    process.exit(1);
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const cv = await getOpenCv();
  const originalBuffer = fs.readFileSync(ORIGINAL_PATH);
  const resultBuffer = fs.readFileSync(RESULT_PATH);

  const { mat: originalRgba, width: originalWidth, height: originalHeight } = await decodeToMat(originalBuffer);
  const { mat: resultRgbaRaw } = await decodeToMat(resultBuffer);

  const maskResult = await buildFloorplanMask(originalBuffer);

  const resized = await forceOriginalDimensions(resultRgbaRaw, originalWidth, originalHeight);
  const corrected = await overlayOriginalWallLines(originalRgba, resized, maskResult.wallsMaskOriginalRes);

  // The REAL check, exactly as routes/generateHumanizedFloorplan.ts calls it.
  const suspiciousCheck = await detectSuspiciousNewText(corrected, maskResult.protectedMask);
  console.log('Resultado real do detector (rodando localmente, sem chamada de IA):');
  console.log(`  newTextBlobCount = ${suspiciousCheck.newTextBlobCount}`);
  console.log(`  suspicious = ${suspiciousCheck.suspicious}`);
  if (suspiciousCheck.reason) console.log(`  reason = ${suspiciousCheck.reason}`);

  // --- Rebuild per-blob bounding boxes for visualization (countBlobs() only returns a count, not boxes — connectedComponentsWithStats gives us both, using the exact same candidate mask the real check computed internally). ---
  const gray = new cv.Mat();
  cv.cvtColor(corrected, gray, cv.COLOR_RGBA2GRAY);
  const textInResult = await detectTextLikeMask(gray, gray);

  const notProtected = new cv.Mat();
  cv.bitwise_not(maskResult.protectedMask, notProtected);
  const newTextMask = new cv.Mat();
  cv.bitwise_and(textInResult, notProtected, newTextMask);
  const existingTextMask = new cv.Mat();
  cv.bitwise_and(textInResult, maskResult.protectedMask, existingTextMask);

  function extractBoxes(mask: Mat): { x: number; y: number; w: number; h: number; area: number }[] {
    const labels = new cv.Mat();
    const stats = new cv.Mat();
    const centroids = new cv.Mat();
    const numLabels = cv.connectedComponentsWithStats(mask, labels, stats, centroids, 8, cv.CV_32S);
    const boxes: { x: number; y: number; w: number; h: number; area: number }[] = [];
    for (let label = 1; label < numLabels; label++) {
      boxes.push({
        x: stats.intAt(label, cv.CC_STAT_LEFT),
        y: stats.intAt(label, cv.CC_STAT_TOP),
        w: stats.intAt(label, cv.CC_STAT_WIDTH),
        h: stats.intAt(label, cv.CC_STAT_HEIGHT),
        area: stats.intAt(label, cv.CC_STAT_AREA),
      });
    }
    labels.delete();
    stats.delete();
    centroids.delete();
    return boxes;
  }

  const newTextBoxes = extractBoxes(newTextMask);
  const existingTextBoxes = extractBoxes(existingTextMask);

  console.log(`\nCaixas extraídas para visualização: ${newTextBoxes.length} suspeitas (novas), ${existingTextBoxes.length} texto/cota original (já protegido, não sinalizado).`);

  // --- Debug image: red = new/suspicious (what the real rejection would flag), yellow = pre-existing text/dimension marks inside the protected mask (never flagged, shown only for contrast). ---
  const debugViz = new cv.Mat();
  corrected.copyTo(debugViz);
  for (const box of existingTextBoxes) {
    cv.rectangle(debugViz, new cv.Point(box.x, box.y), new cv.Point(box.x + box.w, box.y + box.h), new cv.Scalar(230, 190, 0, 255), 1);
  }
  let idx = 1;
  for (const box of newTextBoxes) {
    cv.rectangle(debugViz, new cv.Point(box.x, box.y), new cv.Point(box.x + box.w, box.y + box.h), new cv.Scalar(230, 20, 20, 255), 2);
    cv.putText(debugViz, String(idx), new cv.Point(box.x, Math.max(10, box.y - 3)), cv.FONT_HERSHEY_SIMPLEX, 0.35, new cv.Scalar(230, 20, 20, 255), 1, cv.LINE_AA);
    idx++;
  }

  async function savePng(mat: Mat, filename: string) {
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), await encodeMatToPng(mat));
  }

  await savePng(originalRgba, '01-original.png');
  await savePng(corrected, '02-resultado-corrigido.png');
  await savePng(maskResult.protectedMask, '03-mascara-protegida.png');
  await savePng(debugViz, '04-elementos-suspeitos-marcados.png');

  const report = {
    aviso: 'Este NÃO é o job rejeitado específico visto no frontend (53 elementos) — aquele resultado nunca foi salvo em disco, por desenho (ver routes/generateHumanizedFloorplan.ts). Esta é uma reprodução real e offline do MESMO detector, rodando sobre o único resultado real salvo neste projeto.',
    arquivoOriginal: ORIGINAL_PATH,
    arquivoResultado: RESULT_PATH,
    newTextBlobCountReal: suspiciousCheck.newTextBlobCount,
    suspicious: suspiciousCheck.suspicious,
    reason: suspiciousCheck.reason ?? null,
    caixasSuspeitas: newTextBoxes,
    caixasTextoExistenteProtegido: existingTextBoxes,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, '05-relatorio.json'), JSON.stringify(report, null, 2));

  console.log(`\nArquivos salvos em: ${OUTPUT_DIR}`);
  console.log('Nenhuma chamada de rede foi feita (OpenAI, Gemini, BFL e FLUX não foram acionados).');

  originalRgba.delete();
  resultRgbaRaw.delete();
  resized.delete();
  corrected.delete();
  maskResult.protectedMask.delete();
  maskResult.wallsMaskOriginalRes.delete();
  gray.delete();
  textInResult.delete();
  notProtected.delete();
  newTextMask.delete();
  existingTextMask.delete();
  debugViz.delete();
}

main().catch((err) => {
  console.error('Debug script crashed:', err);
  process.exit(1);
});
