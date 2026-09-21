/**
 * SECOND authorized real execution — same floor plan, same CONFIRMED mask
 * from the first run (backend/test-output/humanized-floorplan-real-execution-01/02-mascara-automatica.png),
 * exercising the real HTTP API exactly as the frontend would (confirm mask
 * -> generate -> poll). Exactly one POST to /generate-humanized-floorplan.
 * After the job finishes, also reads back the server's own private
 * diagnostics (vision-detection JSON per crop, raw Fill output) directly
 * from disk for the detailed report — these are never exposed via the HTTP
 * API, only written to backend/private-diagnostics/.
 *
 * Run with: npx tsx scripts/inspect-humanized-floorplan-real-run-02.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'http://localhost:8787';
const IMAGE_PATH = path.resolve(__dirname, '../test-fixtures/floorplans/planta-tecnica-real-01.jpg');
const CONFIRMED_MASK_PATH = path.resolve(__dirname, '../test-output/humanized-floorplan-real-execution-01/02-mascara-automatica.png');
const OUTPUT_DIR = path.resolve(__dirname, '../test-output/humanized-floorplan-real-execution-02');
const PRIVATE_DIAGNOSTICS_ROOT = path.resolve(__dirname, '../private-diagnostics');
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
    fs.writeFileSync(path.join(OUTPUT_DIR, '05-resultado-final.png'), imgBuffer);
    resultSaved = true;
  }

  const walletAfter = (await (await fetch(`${BASE_URL}/api/wallet`)).json()) as { balance: number };

  // --- Read back the server's own private diagnostics for this exact jobId (never exposed via HTTP) ---
  const visionDiagDir = path.join(PRIVATE_DIAGNOSTICS_ROOT, 'humanized-floorplan-vision-detections', jobId);
  const rejectionDiagDir = path.join(PRIVATE_DIAGNOSTICS_ROOT, 'humanized-floorplan-rejections', jobId);
  const rawResultDir = path.join(PRIVATE_DIAGNOSTICS_ROOT, 'humanized-floorplan-raw-results', jobId);

  const visionDiagnostics: Record<string, unknown> = {};
  if (fs.existsSync(visionDiagDir)) {
    for (const file of fs.readdirSync(visionDiagDir)) {
      visionDiagnostics[file] = JSON.parse(fs.readFileSync(path.join(visionDiagDir, file), 'utf8'));
    }
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, '06-vision-detection-diagnostics.json'), JSON.stringify(visionDiagnostics, null, 2));

  let rawResultCopied: string | null = null;
  if (fs.existsSync(rawResultDir)) {
    for (const file of fs.readdirSync(rawResultDir)) {
      fs.copyFileSync(path.join(rawResultDir, file), path.join(OUTPUT_DIR, `07-resultado-bruto-flux${path.extname(file)}`));
      rawResultCopied = file;
    }
  }

  let rejectionDiagnostics: Record<string, unknown> | null = null;
  if (fs.existsSync(rejectionDiagDir)) {
    rejectionDiagnostics = {};
    for (const file of fs.readdirSync(rejectionDiagDir)) {
      if (file.endsWith('.json')) {
        rejectionDiagnostics[file] = JSON.parse(fs.readFileSync(path.join(rejectionDiagDir, file), 'utf8'));
      } else {
        fs.copyFileSync(path.join(rejectionDiagDir, file), path.join(OUTPUT_DIR, `08-diagnostico-rejeicao-${file}`));
      }
    }
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
    rawResultCopied,
    visionDiagnosticsCropFiles: Object.keys(visionDiagnostics),
    hasRejectionDiagnostics: rejectionDiagnostics !== null,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, '09-resumo.json'), JSON.stringify(summary, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('\n=== VISION DIAGNOSTICS ===');
  console.log(JSON.stringify(visionDiagnostics, null, 2));
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
