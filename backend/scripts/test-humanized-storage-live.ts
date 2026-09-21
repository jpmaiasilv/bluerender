/**
 * LIVE validation of the private Supabase Storage bucket used by Planta
 * Humanizada, against the real project configured in backend/.env. It only
 * uploads tiny throw-away files under random ids and deletes them at the end.
 * No OpenAI call, no credits, no user data touched.
 *
 * Run: npm run test:storage-live -w backend      (needs SUPABASE_* in backend/.env;
 *      the bucket "humanized-floorplans" must exist — see the storage migration)
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', 'frontend', '.env') });

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log('        ', err instanceof Error ? err.message : err);
    failed++;
  }
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('SKIPPED: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.');
    return;
  }
  const { SupabaseFileStorage, HUMANIZED_BUCKET } = await import('../src/storage/humanizedFloorplanFiles');
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const publishable = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const storage = new SupabaseFileStorage();

  const userId = crypto.randomUUID();
  const genId = crypto.randomUUID();
  const otherUser = crypto.randomUUID();
  console.log(`Live Storage validation — bucket "${HUMANIZED_BUCKET}" on the configured Supabase project\n`);

  await test('the bucket exists, is PRIVATE, and restricts MIME types and size', async () => {
    const { data, error } = await admin.storage.getBucket(HUMANIZED_BUCKET);
    assert.ok(!error && data, 'bucket must exist');
    assert.equal(data!.public, false);
    assert.deepEqual([...(data!.allowed_mime_types ?? [])].sort(), ['image/jpeg', 'image/png', 'image/webp']);
    assert.ok(Number(data!.file_size_limit) > 0 && Number(data!.file_size_limit) <= 20 * 1024 * 1024);
  });

  let originalPath = '';
  let resultPath = '';
  let jpgPath = '';

  await test('save: original, result PNG and result JPG land at <user>/<generation>/<kind>.<ext>', async () => {
    originalPath = await storage.save(userId, genId, 'original', PNG, 'image/png');
    resultPath = await storage.save(userId, genId, 'result', PNG, 'image/png');
    jpgPath = await storage.save(userId, genId, 'result', PNG, 'image/jpeg');
    assert.equal(originalPath, `${userId}/${genId}/original.png`);
    assert.equal(resultPath, `${userId}/${genId}/result.png`);
    assert.equal(jpgPath, `${userId}/${genId}/result.jpg`);
    assert.equal(await storage.exists(resultPath), true);
    assert.deepEqual(await storage.read(resultPath), PNG);
  });

  await test('a signed URL works, returns the exact bytes, and applies the requested download filename', async () => {
    const url = await storage.signedUrl(resultPath, 'planta-humanizada-2026-09-20-abc12345.png');
    assert.ok(url && /\/storage\/v1\/object\/sign\//.test(url));
    const res = await fetch(url!);
    assert.equal(res.status, 200);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
    assert.match(res.headers.get('content-disposition') ?? '', /planta-humanizada-2026-09-20-abc12345\.png/);
  });

  await test('the PUBLIC url of the same object does NOT work (bucket is private, no permanent URL exists)', async () => {
    const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${HUMANIZED_BUCKET}/${resultPath}`;
    const res = await fetch(publicUrl);
    assert.ok(res.status === 400 || res.status === 404, `expected 400/404, got ${res.status}`);
  });

  await test('a tampered signed URL is rejected', async () => {
    const url = (await storage.signedUrl(resultPath))!;
    const tampered = url.replace(/token=([^&]+)/, (_m, t) => `token=${t.slice(0, -3)}AAA`);
    assert.notEqual(tampered, url);
    const res = await fetch(tampered);
    assert.ok(res.status >= 400, `expected an error, got ${res.status}`);
  });

  await test('an EXPIRED signed URL is rejected (1-second URL, fetched after it lapsed)', async () => {
    const { data, error } = await admin.storage.from(HUMANIZED_BUCKET).createSignedUrl(resultPath, 1);
    assert.ok(!error && data);
    assert.equal((await fetch(data!.signedUrl)).status, 200);
    await new Promise((r) => setTimeout(r, 2500));
    const res = await fetch(data!.signedUrl);
    assert.ok(res.status >= 400, `expected an error after expiry, got ${res.status}`);
  });

  await test('signing a path that does not exist (e.g. another user\'s guess) yields no URL', async () => {
    assert.equal(await storage.signedUrl(`${otherUser}/${genId}/result.png`), null);
    assert.equal(await storage.read(`${otherUser}/${genId}/result.png`), null);
  });

  await test('anonymous access with the publishable key cannot list or download the objects (storage RLS)', async () => {
    assert.ok(publishable, 'frontend/.env must provide VITE_SUPABASE_PUBLISHABLE_KEY for this check');
    const anon = createClient(process.env.SUPABASE_URL!, publishable!, { auth: { persistSession: false } });
    const listed = await anon.storage.from(HUMANIZED_BUCKET).list(`${userId}/${genId}`);
    assert.ok(!listed.data || listed.data.length === 0, 'anon must not see any object');
    const dl = await anon.storage.from(HUMANIZED_BUCKET).download(resultPath);
    assert.ok(dl.error && !dl.data, 'anon download must fail');
    const up = await anon.storage.from(HUMANIZED_BUCKET).upload(`${userId}/${genId}/evil.png`, PNG, { contentType: 'image/png' });
    assert.ok(up.error, 'anon upload must fail');
  });

  await test('the bucket refuses non-image content (HTML upload is rejected)', async () => {
    const r = await admin.storage.from(HUMANIZED_BUCKET).upload(`${userId}/${genId}/bad.html`, Buffer.from('<script>alert(1)</script>'), { contentType: 'text/html' });
    assert.ok(r.error, 'text/html must be refused by the bucket MIME allow-list');
  });

  await test('the storage adapter never builds a path from unsafe input', async () => {
    await assert.rejects(() => storage.save('../evil', genId, 'original', PNG, 'image/png'));
    await assert.rejects(() => storage.save(userId, genId, 'original', PNG, 'text/html'));
    await assert.rejects(() => storage.save(userId, genId, 'original', Buffer.alloc(0), 'image/png'));
  });

  await test('removeGeneration deletes every file of the generation, and only that generation', async () => {
    const otherGen = crypto.randomUUID();
    const keep = await storage.save(userId, otherGen, 'original', PNG, 'image/png');
    await storage.removeGeneration(userId, genId);
    assert.equal(await storage.exists(originalPath), false);
    assert.equal(await storage.exists(resultPath), false);
    assert.equal(await storage.exists(jpgPath), false);
    assert.equal(await storage.exists(keep), true);
    await storage.removeGeneration(userId, otherGen);
    assert.equal(await storage.exists(keep), false);
  });

  // Safety net: nothing must remain under the throw-away user, whatever happened above.
  await storage.removeGeneration(userId, genId).catch(() => undefined);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Live storage test crashed:', err);
  process.exit(1);
});
