/**
 * ETAPA 11 — the ONE real, controlled Topaz call. Exercises the exact same
 * modules the HTTP route uses (Supabase Storage, upscale_jobs table, credit
 * wallet, Topaz client) directly, bypassing Express/auth middleware so no
 * session token needs to be minted or handled in chat. Run manually, once:
 *
 *   npx tsx scripts/run-real-topaz-test.ts <email>
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sizeOf from 'image-size';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npx tsx scripts/run-real-topaz-test.ts <email>');
    process.exit(1);
  }

  const { getSupabaseAdmin } = await import('../src/lib/supabaseAdmin');
  const { reserveCredits, captureCredits, refundCredits } = await import('../src/services/creditWallet');
  const { getUpscaleStore } = await import('../src/services/upscaleStore');
  const { getUpscaleFileStorage } = await import('../src/storage/upscaleFiles');
  const { createEnhanceJob, getEnhanceStatus, downloadEnhanceResult } = await import('../src/providers/topazClient');
  const { TOPAZ_MODEL, creditsForScale } = await import('../src/config/topaz');

  const admin = getSupabaseAdmin();
  const { data: userList, error: userErr } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (userErr) throw new Error(`Could not list users: ${userErr.message}`);
  const user = userList.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`No Supabase user found for ${email}`);

  const imagePath = path.resolve(__dirname, '..', 'public', 'results', 'f857352b-318e-442b-b9da-b94d6796173a.jpg');
  const inputBuffer = fs.readFileSync(imagePath);
  const dims = sizeOf(inputBuffer);
  if (!dims.width || !dims.height) throw new Error('Could not read test image dimensions.');

  const scale = 2 as const;
  const outputWidth = dims.width * scale;
  const outputHeight = dims.height * scale;
  const credits = creditsForScale(scale);
  const jobId = crypto.randomUUID();

  console.log('--- Upscale IA — single controlled Topaz test ---');
  console.log(`User: ${email} (${user.id})`);
  console.log(`Input: ${imagePath}`);
  console.log(`Input resolution: ${dims.width}x${dims.height} (${inputBuffer.length} bytes)`);
  console.log(`Scale: ${scale}x -> expected output: ${outputWidth}x${outputHeight}`);
  console.log(`Model: ${TOPAZ_MODEL}`);
  console.log(`Internal credits for this test: ${credits}`);

  const startedAt = Date.now();
  let reservation: Awaited<ReturnType<typeof reserveCredits>> | null = null;
  let providerProcessId: string | null = null;

  try {
    reservation = await reserveCredits({ userId: user.id, amount: credits, tool: 'upscale', generationId: jobId });
    console.log(`Credits reserved. Balance after reservation: ${reservation.balanceAfter}`);

    const store = await getUpscaleStore();
    console.log(`Store backend resolved: ${store.backend}`);
    await store.insert({
      id: jobId,
      userId: user.id,
      idempotencyKey: null,
      status: 'queued',
      provider: 'topaz',
      providerProcessId: null,
      model: TOPAZ_MODEL,
      scale,
      originalWidth: dims.width,
      originalHeight: dims.height,
      outputWidth,
      outputHeight,
      originalPath: null,
      resultPath: null,
      creditsReserved: credits,
      creditsCaptured: 0,
      creditsRefunded: 0,
      reservationId: reservation.id,
      captureTransactionId: null,
      refundTransactionId: null,
      errorCode: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    });

    const storage = await getUpscaleFileStorage();
    console.log(`File storage backend resolved: ${storage.backend}`);
    const originalPath = await storage.save(user.id, jobId, 'original', inputBuffer, 'image/jpeg');
    console.log(`Original saved at: ${originalPath}`);

    console.log('Calling Topaz enhance/async ...');
    const enhance = await createEnhanceJob({
      imageBuffer: inputBuffer,
      inputMime: 'image/jpeg',
      outputWidth,
      outputHeight,
      outputFormat: 'jpeg',
    });
    providerProcessId = enhance.processId;
    const maskedId = enhance.processId.length > 8 ? `${enhance.processId.slice(0, 4)}...${enhance.processId.slice(-4)}` : '****';
    console.log(`Topaz process_id (masked): ${maskedId} | eta: ${enhance.eta}`);
    await store.update(user.id, jobId, { status: 'processing', providerProcessId: enhance.processId });

    let status = await getEnhanceStatus(enhance.processId);
    while (status.status === 'Pending' || status.status === 'Processing') {
      console.log(`Topaz status: ${status.status}${status.progress !== null ? ` (${status.progress}%)` : ''}`);
      await new Promise((r) => setTimeout(r, 3000));
      status = await getEnhanceStatus(enhance.processId);
    }
    console.log(`Topaz final status: ${status.status}`);
    if (status.status !== 'Completed') {
      throw new Error(`Topaz reported ${status.status}, not Completed.`);
    }

    const resultBuffer = await downloadEnhanceResult(enhance.processId);
    console.log(`Result downloaded: ${resultBuffer.length} bytes`);
    const resultDims = sizeOf(resultBuffer);
    console.log(`Result resolution: ${resultDims.width}x${resultDims.height}`);

    const resultPath = await storage.save(user.id, jobId, 'result', resultBuffer, 'image/jpeg');
    console.log(`Result saved at: ${resultPath}`);

    await captureCredits(reservation, credits);
    console.log(`Credits captured: ${credits}`);

    await store.update(user.id, jobId, {
      status: 'completed',
      resultPath,
      creditsCaptured: credits,
      captureTransactionId: reservation.id,
      completedAt: new Date().toISOString(),
    });

    const saved = await store.get(user.id, jobId);
    console.log(`History row present: ${Boolean(saved)} (status=${saved?.status})`);

    const ratioIn = dims.width / dims.height;
    const ratioOut = (resultDims.width ?? 0) / (resultDims.height ?? 1);
    console.log(`Aspect ratio — input: ${ratioIn.toFixed(4)}, output: ${ratioOut.toFixed(4)}, preserved: ${Math.abs(ratioIn - ratioOut) < 0.01}`);
    console.log(`Total time: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    console.log('RESULT: SUCCESS');
  } catch (err) {
    console.error('RESULT: FAILED —', err instanceof Error ? err.message : err);
    if (reservation) {
      await refundCredits(reservation, 'controlled_test_failed');
      console.log('Credits refunded.');
    }
    if (providerProcessId) {
      const { cancelEnhanceJob } = await import('../src/providers/topazClient');
      await cancelEnhanceJob(providerProcessId);
    }
    process.exitCode = 1;
  }
}

main();
