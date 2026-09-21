/**
 * One-off inspection tool for validating the Planta Humanizada OpenCV mask
 * pipeline against a REAL technical floor plan, before any paid BFL call is
 * ever made against it. Read-only against the pipeline: it calls the exact
 * same production functions (buildWorkingImage, detectStructure,
 * buildFloorplanMask) that ship in the actual endpoint — nothing here is a
 * separate/relaxed code path tuned to look good on this one image.
 *
 * Makes NO network calls, spends NO credits, never touches
 * providers/bflFill.ts or providers/bfl.ts.
 *
 * Run with: npm run inspect:floorplan -w backend
 */
import fs from 'node:fs';
import path from 'node:path';
import { getOpenCv, OpenCv } from '../src/lib/floorplanMask/opencvRuntime';
import { decodeToMat, encodeMatToPng } from '../src/lib/floorplanMask/imageIO';
import { buildWorkingImage } from '../src/lib/floorplanMask/preprocess';
import { detectStructure } from '../src/lib/floorplanMask/detectStructure';
import { buildFloorplanMask } from '../src/lib/floorplanMask/buildMask';
import { detectImageMimeType } from '../src/lib/fileSignature';
import { HUMANIZED_FLOORPLAN_DEFAULT_SAFETY_MARGIN_PX } from '../src/config/humanizedFloorplanEngine';

type Mat = InstanceType<OpenCv['Mat']>;

const INPUT_PATH = path.resolve(__dirname, '../test-fixtures/floorplans/planta-tecnica-real-01.jpg');
const OUTPUT_DIR = path.resolve(__dirname, '../test-output/floorplan-real-01');
const OVERLAY_ALPHA = 0.35;

function resizeToOriginal(cv: OpenCv, mat: Mat, width: number, height: number, interpolation: number): Mat {
  const out = new cv.Mat();
  if (mat.cols !== width || mat.rows !== height) {
    cv.resize(mat, out, new cv.Size(width, height), 0, 0, interpolation);
  } else {
    mat.copyTo(out);
  }
  return out;
}

/** Paints `color` (opaque) onto `layer` wherever `mask` is 255 — used for the wall-lines/categorized-elements visualizations. */
function paintMaskColor(cv: OpenCv, layer: Mat, mask: Mat, color: number[]): void {
  layer.setTo(new cv.Scalar(color[0], color[1], color[2], color[3]), mask);
}

async function savePng(mat: Mat, filename: string): Promise<void> {
  const png = await encodeMatToPng(mat);
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), png);
}

async function main() {
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`Arquivo não encontrado em: ${INPUT_PATH}`);
    process.exit(1);
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const cv = await getOpenCv();
  const imageBuffer = fs.readFileSync(INPUT_PATH);
  const detectedMime = detectImageMimeType(imageBuffer);

  const tStart = Date.now();
  const { mat: rgba, width, height } = await decodeToMat(imageBuffer);
  const tDecoded = Date.now();

  // 1) Original normalizada — decoded (EXIF-orientation-corrected by Jimp),
  // re-encoded at the exact original dimensions. No crop, no resize.
  await savePng(rgba, '01-original-normalizada.png');

  const { gray, enhanced, scaleToOriginal } = await buildWorkingImage(rgba, width, height);
  const workingWidth = gray.cols;
  const workingHeight = gray.rows;
  const wasDownscaled = workingWidth !== width || workingHeight !== height;

  // 2) Contraste aplicado — CLAHE/equalizeHist output, upsampled (INTER_LINEAR,
  // since this is a continuous-tone grayscale image) back to the original
  // dimensions purely for delivery; the real detection pass below still runs
  // at working resolution, exactly as production does.
  const enhancedAtOriginal = resizeToOriginal(cv, enhanced, width, height, cv.INTER_LINEAR);
  await savePng(enhancedAtOriginal, '02-contraste-aplicado.png');

  const detection = await detectStructure(gray, enhanced);
  const tDetected = Date.now();

  const wallsAtOriginal = resizeToOriginal(cv, detection.wallsMask, width, height, cv.INTER_NEAREST);
  const furnitureAtOriginal = resizeToOriginal(cv, detection.furnitureMask, width, height, cv.INTER_NEAREST);
  const textAtOriginal = resizeToOriginal(cv, detection.textMask, width, height, cv.INTER_NEAREST);
  const archesAtOriginal = resizeToOriginal(cv, detection.archesMask, width, height, cv.INTER_NEAREST);
  const combinedAtOriginal = resizeToOriginal(cv, detection.combinedMask, width, height, cv.INTER_NEAREST);

  // 3) Linhas detectadas — wall/line mask drawn in red over the original.
  const linesOverlay = new cv.Mat();
  rgba.copyTo(linesOverlay);
  paintMaskColor(cv, linesOverlay, wallsAtOriginal, [220, 30, 30, 255]);
  await savePng(linesOverlay, '03-linhas-detectadas.png');

  // 4) Elementos protegidos — categorized: walls=red, furniture=green,
  // text/dimensions=yellow, arcs/door-swings=blue. Lets a human quickly spot
  // misclassifications by color.
  const categorized = new cv.Mat();
  rgba.copyTo(categorized);
  paintMaskColor(cv, categorized, wallsAtOriginal, [220, 30, 30, 255]);
  paintMaskColor(cv, categorized, furnitureAtOriginal, [0, 170, 60, 255]);
  paintMaskColor(cv, categorized, textAtOriginal, [230, 180, 0, 255]);
  paintMaskColor(cv, categorized, archesAtOriginal, [0, 110, 230, 255]);
  await savePng(categorized, '04-elementos-protegidos.png');

  // 5) Máscara automática (SEM margem de segurança) — black=protegido,
  // white=editável, i.e. the inverse of our internal protected=255 convention.
  const preMarginFill = new cv.Mat();
  cv.bitwise_not(combinedAtOriginal, preMarginFill);
  await savePng(preMarginFill, '05-mascara-automatica.png');

  // 6) Máscara com margem — the REAL production output of buildFloorplanMask
  // (called fresh here, not derived from the intermediates above, to
  // guarantee byte-for-byte parity with what the actual endpoint would use).
  const marginResult = await buildFloorplanMask(imageBuffer);
  const marginFillMask = new cv.Mat();
  cv.bitwise_not(marginResult.protectedMask, marginFillMask);
  await savePng(marginFillMask, '06-mascara-com-margem.png');

  // 7) Preview sobreposta — protected regions (post-margin) in semi-transparent
  // blue over the original; editable areas left untouched/clearly visible.
  const blueLayer = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(30, 90, 230, 255));
  const blended = new cv.Mat();
  cv.addWeighted(rgba, 1 - OVERLAY_ALPHA, blueLayer, OVERLAY_ALPHA, 0, blended);
  const preview = new cv.Mat();
  rgba.copyTo(preview);
  blended.copyTo(preview, marginResult.protectedMask);
  await savePng(preview, '07-preview-sobreposta.png');

  const tEnd = Date.now();

  // --- Report stats ---
  const totalPixels = width * height;
  const protectedPixelsPreMargin = cv.countNonZero(combinedAtOriginal);
  const protectedPixelsPostMargin = cv.countNonZero(marginResult.protectedMask);
  const protectedPctPreMargin = (protectedPixelsPreMargin / totalPixels) * 100;
  const protectedPctPostMargin = (protectedPixelsPostMargin / totalPixels) * 100;
  const editablePctPostMargin = 100 - protectedPctPostMargin;

  const marginAtWorkingRes = Math.max(1, Math.round(HUMANIZED_FLOORPLAN_DEFAULT_SAFETY_MARGIN_PX / scaleToOriginal));
  const marginAtOriginalRes = Math.round(marginAtWorkingRes * scaleToOriginal);

  const report = {
    arquivo: {
      caminho: INPUT_PATH,
      encontrado: true,
      tamanhoBytes: imageBuffer.length,
      formatoDetectado: detectedMime,
    },
    dimensoes: {
      largura: width,
      altura: height,
      proporcao: (width / height).toFixed(3),
      redimensionadoParaDeteccao: wasDownscaled,
      resolucaoTrabalhoDeteccao: wasDownscaled ? `${workingWidth}x${workingHeight}` : 'nenhum redimensionamento (imagem já abaixo do limite de 1600px)',
      fatorEscalaTrabalhoParaOriginal: scaleToOriginal.toFixed(4),
      arquivosDeSaidaMantemDimensaoOriginal: true,
    },
    processamento: {
      tempoDecodificacaoMs: tDecoded - tStart,
      tempoDeteccaoMs: tDetected - tDecoded,
      tempoTotalMs: tEnd - tStart,
    },
    protecao: {
      percentualProtegidoSemMargem: Number(protectedPctPreMargin.toFixed(2)),
      percentualProtegidoComMargem: Number(protectedPctPostMargin.toFixed(2)),
      percentualEditavel: Number(editablePctPostMargin.toFixed(2)),
      margemSegurancaPxResolucaoTrabalho: marginAtWorkingRes,
      margemSegurancaPxResolucaoOriginal: marginAtOriginalRes,
    },
    contagens: detection.counts,
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'relatorio.json'), JSON.stringify(report, null, 2));

  console.log('\n=== Inspeção da planta técnica real ===\n');
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nArquivos salvos em: ${OUTPUT_DIR}`);
  console.log('Nenhuma chamada de rede foi feita. Nenhum crédito foi descontado.');

  rgba.delete();
  gray.delete();
  enhanced.delete();
  enhancedAtOriginal.delete();
  detection.wallsMask.delete();
  detection.furnitureMask.delete();
  detection.textMask.delete();
  detection.archesMask.delete();
  detection.combinedMask.delete();
  wallsAtOriginal.delete();
  furnitureAtOriginal.delete();
  textAtOriginal.delete();
  archesAtOriginal.delete();
  combinedAtOriginal.delete();
  linesOverlay.delete();
  categorized.delete();
  preMarginFill.delete();
  marginResult.protectedMask.delete();
  marginResult.wallsMaskOriginalRes.delete();
  marginFillMask.delete();
  blueLayer.delete();
  blended.delete();
  preview.delete();
}

main().catch((err) => {
  console.error('Inspection script crashed:', err);
  process.exit(1);
});
