/**
 * ONE authorized real execution of the full Planta Humanizada pipeline
 * (OpenCV mask -> OpenAI vision -> FLUX.1 Fill -> validation -> optional
 * OpenAI text verification) against the real technical floor plan already
 * used earlier in this project. Exercises the REAL, unmodified HTTP API
 * exactly as the frontend would (mask preview -> confirm same mask ->
 * generate -> poll), issuing exactly one POST to each endpoint — no retry,
 * no loop, no second job. Requires the dev server to already be running.
 *
 * Run with: npx tsx scripts/inspect-humanized-floorplan-real-run.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'http://localhost:8787';
const IMAGE_PATH = path.resolve(__dirname, '../test-fixtures/floorplans/planta-tecnica-real-01.jpg');
const OUTPUT_DIR = path.resolve(__dirname, '../test-output/humanized-floorplan-real-execution-01');
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
  fs.writeFileSync(path.join(OUTPUT_DIR, '01-original.jpg'), imageBuffer);

  // --- Step 1: free mask preview ---
  const maskForm = new FormData();
  maskForm.append('image', new Blob([imageBuffer]), 'planta-tecnica-real-01.jpg');
  const maskStartedAt = Date.now();
  const maskRes = await fetch(`${BASE_URL}/api/generate-humanized-floorplan/mask`, { method: 'POST', body: maskForm });
  const maskJson = (await maskRes.json()) as { maskDataUrl?: string; originalWidth?: number; originalHeight?: number; error?: unknown };
  const maskElapsedMs = Date.now() - maskStartedAt;
  if (!maskRes.ok || !maskJson.maskDataUrl) {
    console.error('Mask preview failed:', maskRes.status, JSON.stringify(maskJson));
    process.exit(1);
  }
  const maskBase64 = maskJson.maskDataUrl.replace(/^data:image\/png;base64,/, '');
  const maskBuffer = Buffer.from(maskBase64, 'base64');
  fs.writeFileSync(path.join(OUTPUT_DIR, '02-mascara-automatica.png'), maskBuffer);
  console.log(`Mask preview OK in ${maskElapsedMs}ms — ${maskJson.originalWidth}x${maskJson.originalHeight}`);

  // --- Step 2: paid generation, sending the EXACT same auto mask (unedited) ---
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

  // --- Step 3: poll (read-only) until complete/error ---
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
    fs.writeFileSync(path.join(OUTPUT_DIR, '05-resultado-final.png'), imgBuffer);
    resultSaved = true;
  }

  const walletAfter = (await (await fetch(`${BASE_URL}/api/wallet`)).json()) as { balance: number };

  const summary = {
    jobId,
    outcome: finalStatus.stage,
    error: finalStatus.error ?? null,
    result: finalStatus.result ?? null,
    stageEvents,
    maskPreviewElapsedMs: maskElapsedMs,
    totalElapsedMs,
    walletBefore: walletBefore.balance,
    walletAfter: walletAfter.balance,
    creditsDeducted: walletBefore.balance - walletAfter.balance,
    resultImageSaved: resultSaved,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, '06-resumo.json'), JSON.stringify(summary, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nArtifacts saved to: ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error('Runner crashed:', err);
  process.exit(1);
});
