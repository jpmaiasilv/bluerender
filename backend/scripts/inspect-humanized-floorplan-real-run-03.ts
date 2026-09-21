/**
 * THIRD authorized real execution — same floor plan, same CONFIRMED mask,
 * exercising the real HTTP API exactly as the frontend would. Exactly one
 * POST to /generate-humanized-floorplan. After the job finishes, reads back
 * every private diagnostic the server itself wrote (never exposed via the
 * HTTP API), and additionally RECONSTRUCTS two visuals that the pipeline
 * itself doesn't persist (the exact crop sent to FLUX, and the recomposed-
 * but-not-yet-wall-corrected canvas) purely offline, from the real original
 * image + the real logged rect + the real saved raw Fill output — using the
 * exact same pure, deterministic functions the route itself calls. No new
 * network call, no pipeline code touched.
 *
 * Run with: npx tsx scripts/inspect-humanized-floorplan-real-run-03.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { getOpenCv } from '../src/lib/floorplanMask/opencvRuntime';
import { decodeToMat, encodeMatToPng } from '../src/lib/floorplanMask/imageIO';
import { extractUsefulAreaCrop, recomposeOntoOriginalCanvas, PixelRect } from '../src/lib/floorplanMask/usefulAreaCrop';
import { forceOriginalDimensions } from '../src/lib/floorplanMask/floorplanValidation';

const BASE_URL = 'http://localhost:8787';
const IMAGE_PATH = path.resolve(__dirname, '../test-fixtures/floorplans/planta-tecnica-real-01.jpg');
const CONFIRMED_MASK_PATH = path.resolve(__dirname, '../test-output/humanized-floorplan-real-execution-01/02-mascara-automatica.png');
const OUTPUT_DIR = path.resolve(__dirname, '../test-output/humanized-floorplan-real-execution-03');
const PRIVATE_DIAGNOSTICS_ROOT = path.resolve(__dirname, '../private-diagnostics');
const SERVER_LOG_PATH = '/tmp/backend-dev.log';
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

interface StageEvent {
  stage: string;
  providerStatus?: string;
  atMs: number;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const walletBefore = (await (await fetch(`${BASE_URL}/api/wallet`)).json()) as { balance: number };
  console.log('Wallet before:', walletBefore);

  const imageBuffer = fs.readFileSync(IMAGE_PATH);
  const maskBuffer = fs.readFileSync(CONFIRMED_MASK_PATH);
  fs.writeFileSync(path.join(OUTPUT_DIR, '01-original.jpg'), imageBuffer);
  fs.writeFileSync(path.join(OUTPUT_DIR, '02-mascara-confirmada.png'), maskBuffer);

  const genForm = new FormData();
  genForm.append('image', new Blob([imageBuffer]), 'planta-tecnica-real-01.jpg');
  genForm.append('maskOverride', new Blob([maskBuffer]), 'mask.png');

  const genStartedAt = Date.now();
  const genRes = await fetch(`${BASE_URL}/api/generate-humanized-floorplan`, { method: 'POST', body: genForm });
  const genJson = (await genRes.json()) as { jobId?: string; startedAt?: number; error?: unknown };
  if (!genRes.ok || !genJson.jobId) {
    console.error('Generation submission failed:', genRes.status, JSON.stringify(genJson));
    process.exit(1);
  }
  const jobId = genJson.jobId;
  console.log('Job created:', jobId);

  const stageEvents: StageEvent[] = [];
  let lastStage = '';
  let finalStatus: Record<string, unknown> | null = null;

  while (Date.now() - genStartedAt < POLL_TIMEOUT_MS) {
    const statusRes = await fetch(`${BASE_URL}/api/generate-humanized-floorplan/${jobId}`);
    const status = (await statusRes.json()) as Record<string, unknown>;
    const stage = String(status.stage);
    if (stage !== lastStage) {
      stageEvents.push({ stage, providerStatus: status.providerStatus as string | undefined, atMs: Date.now() - genStartedAt });
      console.log(`[+${Date.now() - genStartedAt}ms] stage=${stage}${status.providerStatus ? ` providerStatus=${status.providerStatus}` : ''}`);
      lastStage = stage;
    }
    if (stage === 'complete' || stage === 'error') {
      finalStatus = status;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  if (!finalStatus) {
    console.error('Polling timed out without reaching complete/error.');
    process.exit(1);
  }

  const totalElapsedMs = Date.now() - genStartedAt;
  fs.writeFileSync(path.join(OUTPUT_DIR, '03-status-final.json'), JSON.stringify(finalStatus, null, 2));
  fs.writeFileSync(path.join(OUTPUT_DIR, '04-stage-events.json'), JSON.stringify(stageEvents, null, 2));

  let resultSaved = false;
  if (finalStatus.stage === 'complete' && finalStatus.result) {
    const result = finalStatus.result as { imageUrl: string };
    const imgRes = await fetch(`${BASE_URL}${result.imageUrl}`);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    fs.writeFileSync(path.join(OUTPUT_DIR, '10-resultado-final.png'), imgBuffer);
    resultSaved = true;
  }

  const walletAfter = (await (await fetch(`${BASE_URL}/api/wallet`)).json()) as { balance: number };

  // --- Read back the server's own private diagnostics for this exact jobId ---
  const visionDiagDir = path.join(PRIVATE_DIAGNOSTICS_ROOT, 'humanized-floorplan-vision-detections', jobId);
  const rejectionDiagDir = path.join(PRIVATE_DIAGNOSTICS_ROOT, 'humanized-floorplan-rejections', jobId);
  const rawResultDir = path.join(PRIVATE_DIAGNOSTICS_ROOT, 'humanized-floorplan-raw-results', jobId);
  const textVerificationDiagDir = path.join(PRIVATE_DIAGNOSTICS_ROOT, 'humanized-floorplan-text-verification', jobId);

  const visionDiagnostics: Record<string, unknown> = {};
  if (fs.existsSync(visionDiagDir)) {
    for (const file of fs.readdirSync(visionDiagDir)) {
      visionDiagnostics[file] = JSON.parse(fs.readFileSync(path.join(visionDiagDir, file), 'utf8'));
    }
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, '06-vision-detection-diagnostics.json'), JSON.stringify(visionDiagnostics, null, 2));

  let rawCropResultFile: string | null = null;
  let rawCropResultBuffer: Buffer | null = null;
  if (fs.existsSync(rawResultDir)) {
    for (const file of fs.readdirSync(rawResultDir)) {
      rawCropResultBuffer = fs.readFileSync(path.join(rawResultDir, file));
      fs.writeFileSync(path.join(OUTPUT_DIR, `07-resultado-bruto-flux${path.extname(file)}`), rawCropResultBuffer);
      rawCropResultFile = file;
    }
  }

  let textVerificationDiagnostics: Record<string, unknown> | null = null;
  if (fs.existsSync(textVerificationDiagDir)) {
    const f = path.join(textVerificationDiagDir, 'verification.json');
    if (fs.existsSync(f)) textVerificationDiagnostics = JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  if (textVerificationDiagnostics) fs.writeFileSync(path.join(OUTPUT_DIR, '11-text-verification-diagnostics.json'), JSON.stringify(textVerificationDiagnostics, null, 2));

  let rejectionDiagnostics: Record<string, unknown> | null = null;
  if (fs.existsSync(rejectionDiagDir)) {
    rejectionDiagnostics = {};
    for (const file of fs.readdirSync(rejectionDiagDir)) {
      if (file.endsWith('.json')) {
        rejectionDiagnostics[file] = JSON.parse(fs.readFileSync(path.join(rejectionDiagDir, file), 'utf8'));
      } else {
        fs.copyFileSync(path.join(rejectionDiagDir, file), path.join(OUTPUT_DIR, `12-diagnostico-rejeicao-${file}`));
      }
    }
  }

  // --- Extract the EXACT usefulAreaRect the real run computed, from the server's own log line for this jobId ---
  let usefulAreaRect: PixelRect | null = null;
  let marginPx: number | null = null;
  if (fs.existsSync(SERVER_LOG_PATH)) {
    const log = fs.readFileSync(SERVER_LOG_PATH, 'utf8');
    const marker = `FLUX useful-area crop computed {`;
    const idx = log.lastIndexOf(marker, log.indexOf(jobId) > -1 ? undefined : undefined);
    // Find the specific occurrence that mentions this jobId within its object literal (search all occurrences, pick the one containing jobId).
    let searchFrom = 0;
    while (true) {
      const at = log.indexOf(marker, searchFrom);
      if (at === -1) break;
      const chunkEnd = log.indexOf('\n}', at);
      const chunk = log.slice(at, chunkEnd > -1 ? chunkEnd + 2 : at + 400);
      if (chunk.includes(jobId)) {
        const rectMatch = chunk.match(/usefulAreaRect:\s*\{\s*x:\s*(-?\d+),\s*y:\s*(-?\d+),\s*width:\s*(\d+),\s*height:\s*(\d+)/);
        const marginMatch = chunk.match(/marginPx:\s*(\d+)/);
        if (rectMatch) {
          usefulAreaRect = { x: Number(rectMatch[1]), y: Number(rectMatch[2]), width: Number(rectMatch[3]), height: Number(rectMatch[4]) };
        }
        if (marginMatch) marginPx = Number(marginMatch[1]);
        break;
      }
      searchFrom = at + marker.length;
    }
    void idx;
  }

  // --- Reconstruct (offline, no network, same pure functions the route uses) the crop sent to FLUX and the recomposed-pre-correction canvas ---
  let pixelPreservationCheck: { checkedPoints: number; mismatches: number } | null = null;
  if (usefulAreaRect && rawCropResultBuffer) {
    const cv = await getOpenCv();
    const { mat: originalRgba, width: originalWidth, height: originalHeight } = await decodeToMat(imageBuffer);
    const fillMaskFullSize = new cv.Mat(originalHeight, originalWidth, cv.CV_8UC1, new cv.Scalar(255)); // visual reconstruction only — the real fill mask isn't persisted; an all-white stand-in is enough to re-crop the ORIGINAL IMAGE region for inspection (mask content doesn't affect what the image crop looks like).
    const crop = await extractUsefulAreaCrop(originalRgba, fillMaskFullSize, usefulAreaRect);
    fs.writeFileSync(path.join(OUTPUT_DIR, '05-recorte-enviado-ao-flux.png'), crop.imageCropPng);
    fillMaskFullSize.delete();

    const { mat: rawCropRgba } = await decodeToMat(rawCropResultBuffer);
    const resizedCropResult = await forceOriginalDimensions(rawCropRgba, usefulAreaRect.width, usefulAreaRect.height);
    rawCropRgba.delete();
    const recomposed = await recomposeOntoOriginalCanvas(originalRgba, resizedCropResult, usefulAreaRect);
    resizedCropResult.delete();
    const recomposedPng = await encodeMatToPng(recomposed);
    fs.writeFileSync(path.join(OUTPUT_DIR, '08-resultado-recomposto.png'), recomposedPng);

    // Pixel-exact preservation check OUTSIDE the rect, on the REAL reconstructed recomposed canvas.
    let checkedPoints = 0;
    let mismatches = 0;
    const step = 17; // sample on a grid, checking every pixel would be slow and is unnecessary to prove the point
    for (let y = 0; y < originalHeight; y += step) {
      for (let x = 0; x < originalWidth; x += step) {
        const insideRect = x >= usefulAreaRect.x && x < usefulAreaRect.x + usefulAreaRect.width && y >= usefulAreaRect.y && y < usefulAreaRect.y + usefulAreaRect.height;
        if (insideRect) continue;
        checkedPoints++;
        const o = originalRgba.ucharPtr(y, x);
        const r = recomposed.ucharPtr(y, x);
        if (o[0] !== r[0] || o[1] !== r[1] || o[2] !== r[2] || o[3] !== r[3]) mismatches++;
      }
    }
    pixelPreservationCheck = { checkedPoints, mismatches };

    originalRgba.delete();
    recomposed.delete();
  }

  const summary = {
    jobId,
    outcome: finalStatus.stage,
    error: finalStatus.error ?? null,
    result: finalStatus.result ?? null,
    stageEvents,
    totalElapsedMs,
    walletBefore: walletBefore.balance,
    walletAfter: walletAfter.balance,
    creditsDeducted: walletBefore.balance - walletAfter.balance,
    resultImageSaved: resultSaved,
    rawCropResultFile,
    usefulAreaRect,
    marginPx,
    pixelPreservationCheck,
    visionDiagnosticsCropFiles: Object.keys(visionDiagnostics),
    hasTextVerificationDiagnostics: textVerificationDiagnostics !== null,
    hasRejectionDiagnostics: rejectionDiagnostics !== null,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, '09-resumo.json'), JSON.stringify(summary, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  if (textVerificationDiagnostics) {
    console.log('\n=== TEXT VERIFICATION DIAGNOSTICS ===');
    console.log(JSON.stringify(textVerificationDiagnostics, null, 2));
  }
  if (rejectionDiagnostics) {
    console.log('\n=== REJECTION DIAGNOSTICS ===');
    console.log(JSON.stringify(rejectionDiagnostics, null, 2));
  }
  console.log(`\nArtifacts saved to: ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error('Runner crashed:', err);
  process.exit(1);
});
