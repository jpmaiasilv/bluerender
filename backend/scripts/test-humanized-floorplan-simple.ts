/**
 * Behavioral tests for Planta Humanizada's primary flow. Runs the REAL route,
 * wallet service, generation store, file storage and OpenAI provider code
 * against a LOCAL fake server that impersonates Supabase auth and the OpenAI
 * images API (SUPABASE_URL / OPENAI_BASE_URL point at 127.0.0.1): no request
 * leaves this machine, no key is used, no credit is spent.
 *
 * The wallet / store / file storage are the explicit in-memory / local test
 * backends (never selectable in production). The SQL behind the real backends
 * is validated separately (test-wallet-sql.ts, test-wallet-service.ts).
 *
 * Run with: npm run test:humanized-floorplan-simple -w backend
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
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

// 1x1 opaque PNG.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_B64, 'base64');

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

type EditMode = 'ok' | 'no_image' | 'error400' | 'slow' | 'hang';

const fake = { mode: 'ok' as EditMode, edits: [] as string[], onEdit: null as null | (() => void) };

function startFakeServer(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = req.url ?? '';
      if (url.startsWith('/auth/v1/user')) {
        const token = (req.headers.authorization ?? '').replace('Bearer ', '');
        const id = token === 'token-a' ? USER_A : token === 'token-b' ? USER_B : null;
        if (!id) {
          res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ msg: 'invalid' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id, email: `${id}@test.local`, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }));
        return;
      }
      if (url.startsWith('/v1/images/edits')) {
        fake.edits.push(Buffer.concat(chunks).toString('latin1'));
        fake.onEdit?.();
        if (fake.mode === 'hang') return; // never answers -> the provider's own timeout must fire
        const respond = () => {
          if (fake.mode === 'error400') {
            res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'secret provider detail xyz', type: 'image_generation_user_error', param: 'size', code: 'bad' } }));
            return;
          }
          const body =
            fake.mode === 'no_image'
              ? { created: 1, data: [] }
              : { created: 1, data: [{ b64_json: PNG_B64 }], quality: 'high', size: '1024x1024', usage: { input_tokens: 1500, input_tokens_details: { text_tokens: 500, image_tokens: 1000 }, output_tokens: 4000, total_tokens: 5500 } };
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
        };
        if (fake.mode === 'slow') setTimeout(respond, 150);
        else respond();
        return;
      }
      res.writeHead(404).end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function multipart(fields: Record<string, string>, files: Record<string, { data: Buffer; name: string }> = {}): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const [k, f] of Object.entries(files)) form.append(k, new Blob([new Uint8Array(f.data)]), f.name);
  return form;
}

async function main() {
  console.log('Planta Humanizada — primary flow, behavioral tests (local fake provider, per-user wallet)\n');

  const fakeServer = await startFakeServer();
  const port = (fakeServer.address() as AddressInfo).port;
  process.env.SUPABASE_URL = `http://127.0.0.1:${port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
  process.env.OPENAI_API_KEY = 'fake-openai-key';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.HUMANIZED_FLOORPLAN_REQUEST_TIMEOUT_MS = '1000';
  process.env.WALLET_SIGNUP_BONUS_CREDITS = '100';

  const express = (await import('express')).default;
  const { generateHumanizedFloorplanSimpleRouter, parseSettings } = await import('../src/routes/generateHumanizedFloorplanSimple');
  const walletMod = await import('../src/services/creditWallet');
  const storeMod = await import('../src/services/humanizedFloorplanStore');
  const filesMod = await import('../src/storage/humanizedFloorplanFiles');
  const promptMod = await import('../src/lib/openaiImage/humanizedFloorplanPrompt');
  const styles = await import('../src/config/humanizedFloorplanSimpleStyles');
  const engine = await import('../src/config/humanizedFloorplanEngine');
  const models = await import('../src/config/openaiModels');
  const costMod = await import('../src/services/openaiImageCost');
  const validation = await import('../src/lib/openaiImage/floorplanImageValidation');
  const { getJobCreationLogPath, logJobCreation, readJobCreationLog } = await import('../src/services/jobCreationLog');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'humanized-test-'));
  const filesRoot = path.join(tmpDir, 'files');
  const mem = new walletMod.MemoryWalletBackend();
  const store = new storeMod.LocalGenerationStore(path.join(tmpDir, 'generations.json'));
  const storage = new filesMod.LocalFileStorage(filesRoot);
  walletMod.setWalletBackendForTests(mem);
  storeMod.setGenerationStoreForTests(store);
  filesMod.setFileStorageForTests(storage);

  const app = express();
  app.use(express.json());
  app.use('/api', generateHumanizedFloorplanSimpleRouter);
  const appServer = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const appOrigin = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
  const base = `${appOrigin}/api/generate-humanized-floorplan-simple`;

  const COST = engine.HUMANIZED_FLOORPLAN_WALLET_DEBIT_CREDITS;
  let keyCounter = 0;
  const newKey = () => `test-key-${Date.now()}-${keyCounter++}`;
  const baseFields = (extra: Record<string, string> = {}) => ({ style: 'contemporaneo', idempotencyKey: newKey(), ...extra });
  const floorplan = { image: { data: PNG, name: 'planta.png' } };

  const post = (token: string | null, form: FormData) => fetch(base, { method: 'POST', body: form, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const getJson = async (p: string, token: string | null) => {
    const r = await fetch(`${base}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: r.status, body: (await r.json()) as any };
  };
  async function waitDone(id: string, token: string) {
    for (let i = 0; i < 200; i++) {
      const { body } = await getJson(`/${id}`, token);
      if (body.stage === 'complete' || body.stage === 'error') return body;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error('generation did not finish');
  }
  const bal = (u: string = USER_A) => mem.balance(u);
  const kinds = async (u: string, id: string) => (await mem.ledgerForGeneration(u, id)).map((m) => m.type);
  async function setBalance(u: string, target: number) {
    await mem.ensure(u, 100);
    const cur = await mem.balance(u);
    if (cur > target) {
      const r = await mem.reserve({ userId: u, amount: cur - target, tool: 'test_setup', generationId: null, idempotencyKey: null });
      await mem.capture(u, r.reservationId); // consumed, so it never shows up as a pending reservation
    }
    else if (cur < target) await mem.credit(u, target - cur, 'test_setup', 'test', null);
  }
  const reset = async () => {
    fake.mode = 'ok';
    fake.edits.length = 0;
    fake.onEdit = null;
    await setBalance(USER_A, 100);
    await setBalance(USER_B, 100);
  };
  async function generate(fields: Record<string, string> = {}, files: Record<string, { data: Buffer; name: string }> = floorplan, token = 'token-a') {
    const r = await post(token, multipart(baseFields(fields), files));
    return { status: r.status, body: (await r.json()) as any };
  }

  // ---------------------------------------------------------------- credits (per-user wallet)
  await test('cost is 2 credits from one shared backend constant, /config reports it, and no stale 24 remains in the route', async () => {
    assert.equal(COST, 2);
    assert.equal((await getJson('/config', null)).body.costCredits, COST);
    const src = fs.readFileSync(path.resolve(__dirname, '../src/routes/generateHumanizedFloorplanSimple.ts'), 'utf8');
    assert.ok(!/\b24\b/.test(src));
  });

  await test('successful generation: reserve -> capture (2 credits), ledger = reserve+capture, record completed with movement ids', async () => {
    await reset();
    const { status, body } = await generate();
    assert.equal(status, 202);
    const done = await waitDone(body.jobId, 'token-a');
    assert.equal(done.stage, 'complete');
    assert.equal(await bal(), 100 - COST);
    assert.deepEqual(await kinds(USER_A, body.jobId), ['reserve', 'capture']);
    const rec = await store.get(USER_A, body.jobId);
    assert.equal(rec!.status, 'completed');
    assert.equal(rec!.creditsReserved, COST);
    assert.equal(rec!.creditsCaptured, COST);
    assert.ok(rec!.reservationId && rec!.captureTransactionId);
    assert.equal(fake.edits.length, 1);
  });

  await test('wallets are independent per user: A generating does not change B\'s balance', async () => {
    await reset();
    const { body } = await generate({}, floorplan, 'token-a');
    await waitDone(body.jobId, 'token-a');
    assert.equal(await bal(USER_A), 100 - COST);
    assert.equal(await bal(USER_B), 100);
    const b = await generate({}, floorplan, 'token-b');
    await waitDone(b.body.jobId, 'token-b');
    assert.equal(await bal(USER_B), 100 - COST);
    assert.equal(await bal(USER_A), 100 - COST);
  });

  await test('the provider request uses OPENAI_BLOCK_IMAGE_MODEL, opaque background, quality auto, NO input_fidelity, the size detected from the plan (a 1:1 plan -> 1024x1024)', async () => {
    await reset();
    const { body } = await generate();
    await waitDone(body.jobId, 'token-a');
    const raw = fake.edits[0];
    assert.ok(raw.includes(models.OPENAI_BLOCK_IMAGE_MODEL));
    assert.ok(/name="background"\r\n\r\nopaque/.test(raw));
    assert.ok(/name="quality"\r\n\r\nauto/.test(raw));
    assert.ok(!raw.includes('input_fidelity'));
    assert.ok(/name="size"\r\n\r\n1024x1024/.test(raw), 'the nearest supported size is now sent even for the original format');
    assert.ok(raw.includes('PRIORITY 1'));
  });

  await test('provider usage/quality/size are recorded; cost is null without configured prices (image still delivered)', async () => {
    await reset();
    const { body } = await generate();
    await waitDone(body.jobId, 'token-a');
    const rec = await store.get(USER_A, body.jobId);
    assert.deepEqual(rec!.usage, { textInputTokens: 500, imageInputTokens: 1000, imageOutputTokens: 4000, totalTokens: 5500 });
    assert.equal(rec!.quality, 'high');
    assert.equal(rec!.size, '1024x1024');
    assert.equal(rec!.costUsd, null);
  });

  await test('cost function: computes from configurable prices, null when a price or usage is missing, never throws', () => {
    const usage = { textInputTokens: 1_000_000, imageInputTokens: 2_000_000, imageOutputTokens: 1_000_000, totalTokens: 4_000_000 };
    assert.equal(costMod.estimateOpenAiImageCostUsd(usage, { textInputPerM: 5, imageInputPerM: 10, imageOutputPerM: 40 }), 65);
    assert.equal(costMod.estimateOpenAiImageCostUsd(usage, { textInputPerM: 5, imageInputPerM: null, imageOutputPerM: 40 }), null);
    assert.equal(costMod.estimateOpenAiImageCostUsd(null, { textInputPerM: 5, imageInputPerM: 10, imageOutputPerM: 40 }), null);
  });

  await test('user with fewer than 2 credits: 402, no reservation, no provider call, no leftover record', async () => {
    await reset();
    await setBalance(USER_A, 1);
    const { status, body } = await generate();
    assert.equal(status, 402);
    assert.equal(body.error.code, 'INSUFFICIENT_CREDITS');
    assert.equal(fake.edits.length, 0);
    assert.equal(await bal(), 1);
    assert.equal((await store.list(USER_A, 500)).filter((r) => r.status === 'processing').length, 0);
  });

  await test('exactly 2 credits: one generation succeeds (balance 0), the next is refused; balance never goes negative', async () => {
    await reset();
    await setBalance(USER_A, 2);
    const first = await generate();
    assert.equal(first.status, 202);
    await waitDone(first.body.jobId, 'token-a');
    assert.equal(await bal(), 0);
    assert.equal((await generate()).status, 402);
    assert.equal(await bal(), 0);
  });

  await test('double click: two simultaneous requests with the SAME idempotency key create ONE generation, ONE provider call, ONE charge', async () => {
    await reset();
    fake.mode = 'slow';
    const key = newKey();
    const [a, b] = await Promise.all([post('token-a', multipart({ style: 'minimalista', idempotencyKey: key }, floorplan)), post('token-a', multipart({ style: 'minimalista', idempotencyKey: key }, floorplan))]);
    const [ja, jb] = [(await a.json()) as any, (await b.json()) as any];
    assert.equal(a.status, 202);
    assert.equal(b.status, 202);
    assert.equal(ja.jobId, jb.jobId);
    await waitDone(ja.jobId, 'token-a');
    assert.equal(fake.edits.length, 1);
    assert.equal(await bal(), 100 - COST);
    assert.equal((await store.list(USER_A, 500)).filter((r) => r.idempotencyKey === key).length, 1);
  });

  await test('idempotency is PERSISTENT: a key already stored in the database returns that generation without charging (server restart case)', async () => {
    await reset();
    const key = newKey();
    const first = (await (await post('token-a', multipart({ style: 'classico', idempotencyKey: key }, floorplan))).json()) as any;
    await waitDone(first.jobId, 'token-a');
    const again = (await (await post('token-a', multipart({ style: 'classico', idempotencyKey: key }, floorplan))).json()) as any;
    assert.equal(again.jobId, first.jobId);
    // Simulate a restart: a key that exists ONLY in the database (no in-process claim).
    const legacyId = '55555555-5555-4555-8555-555555555555';
    await store.insert({ ...(await store.get(USER_A, first.jobId))!, id: legacyId, idempotencyKey: 'only-in-database-key' });
    const viaDb = (await (await post('token-a', multipart({ style: 'classico', idempotencyKey: 'only-in-database-key' }, floorplan))).json()) as any;
    assert.equal(viaDb.jobId, legacyId);
    assert.equal(fake.edits.length, 1);
    assert.equal(await bal(), 100 - COST);
  });

  await test('two simultaneous requests with DIFFERENT keys and credit for only one: exactly one accepted, the other 402, balance ends at 0', async () => {
    await reset();
    await setBalance(USER_A, 2);
    fake.mode = 'slow';
    const [a, b] = await Promise.all([generate(), generate()]);
    assert.deepEqual([a.status, b.status].sort(), [202, 402]);
    const ok = a.status === 202 ? a : b;
    await waitDone(ok.body.jobId, 'token-a');
    assert.equal(fake.edits.length, 1);
    assert.equal(await bal(), 0);
    assert.equal((await store.list(USER_A, 500)).filter((r) => r.status === 'processing').length, 0);
  });

  await test('polling (GET) any number of times never calls the provider or touches credits', async () => {
    await reset();
    const { body } = await generate();
    await waitDone(body.jobId, 'token-a');
    const before = { edits: fake.edits.length, balance: await bal() };
    for (let i = 0; i < 5; i++) await getJson(`/${body.jobId}`, 'token-a');
    assert.equal(fake.edits.length, before.edits);
    assert.equal(await bal(), before.balance);
  });

  // ---------------------------------------------------------------- failures -> refund
  await test('failure BEFORE the provider (unknown source generation): 404, credits untouched, no provider call, no stuck record', async () => {
    await reset();
    const before = (await store.list(USER_A, 500)).length;
    const r = await post('token-a', multipart({ ...baseFields(), sourceGenerationId: '99999999-9999-4999-8999-999999999999' }));
    assert.equal(r.status, 404);
    assert.equal(await bal(), 100);
    assert.equal(fake.edits.length, 0);
    assert.equal((await store.list(USER_A, 500)).length, before);
  });

  await test('failure while storing the INPUT files (before the provider): refunded, record failed, no provider call', async () => {
    await reset();
    const realSave = storage.save.bind(storage);
    storage.save = async () => {
      throw new Error('bucket offline');
    };
    try {
      const r = await generate();
      assert.equal(r.status, 503);
      assert.equal(await bal(), 100);
      assert.equal(fake.edits.length, 0);
      const failed = (await store.list(USER_A, 50)).find((x) => x.status === 'failed' && x.errorCode === 'PROVIDER_UNAVAILABLE');
      assert.ok(failed);
      assert.deepEqual(await kinds(USER_A, failed!.id), ['reserve', 'refund']);
    } finally {
      storage.save = realSave;
    }
  });

  await test('provider error: job fails, credits refunded once, ledger reserve+refund, creditsCaptured 0, no provider detail leaks', async () => {
    await reset();
    fake.mode = 'error400';
    const { body } = await generate();
    const done = await waitDone(body.jobId, 'token-a');
    assert.equal(done.stage, 'error');
    assert.equal(await bal(), 100);
    const rec = await store.get(USER_A, body.jobId);
    assert.equal(rec!.status, 'failed');
    assert.equal(rec!.creditsCaptured, 0);
    assert.equal(rec!.creditsRefunded, COST);
    assert.ok(rec!.refundTransactionId);
    assert.deepEqual(await kinds(USER_A, body.jobId), ['reserve', 'refund']);
    assert.ok(!JSON.stringify(done).includes('secret provider detail'));
    assert.ok(!JSON.stringify(rec).includes('secret provider detail'));
  });

  await test('provider TIMEOUT: generation fails with GENERATION_TIMEOUT and the credits are refunded', async () => {
    await reset();
    fake.mode = 'hang';
    const { body } = await generate();
    const done = await waitDone(body.jobId, 'token-a');
    assert.equal(done.stage, 'error');
    assert.equal(done.error.code, 'GENERATION_TIMEOUT');
    assert.equal(await bal(), 100);
    assert.deepEqual(await kinds(USER_A, body.jobId), ['reserve', 'refund']);
  });

  await test('provider answers without an image: refunded, failed', async () => {
    await reset();
    fake.mode = 'no_image';
    const { body } = await generate();
    assert.equal((await waitDone(body.jobId, 'token-a')).stage, 'error');
    assert.equal(await bal(), 100);
    assert.equal((await store.get(USER_A, body.jobId))!.status, 'failed');
  });

  await test('failure while UPLOADING the result image: refunded, failed, no completed state', async () => {
    await reset();
    const realSave = storage.save.bind(storage);
    storage.save = async (u, g, kind, buf, mime) => {
      if (kind === 'result') throw new Error('bucket offline');
      return realSave(u, g, kind, buf, mime);
    };
    try {
      const { body } = await generate();
      const done = await waitDone(body.jobId, 'token-a');
      assert.equal(done.stage, 'error');
      assert.equal(await bal(), 100);
      const rec = await store.get(USER_A, body.jobId);
      assert.equal(rec!.status, 'failed');
      assert.equal(rec!.creditsCaptured, 0);
      assert.deepEqual(await kinds(USER_A, body.jobId), ['reserve', 'refund']);
    } finally {
      storage.save = realSave;
    }
  });

  await test('failure AFTER the result is uploaded but BEFORE the capture: refunded, never charged, never "completed"', async () => {
    await reset();
    const realCapture = mem.capture.bind(mem);
    mem.capture = async () => {
      throw new Error('database unavailable during capture');
    };
    try {
      const { body } = await generate();
      const done = await waitDone(body.jobId, 'token-a');
      assert.equal(done.stage, 'error');
      assert.equal(await bal(), 100);
      const rec = await store.get(USER_A, body.jobId);
      assert.equal(rec!.status, 'failed');
      assert.deepEqual(await kinds(USER_A, body.jobId), ['reserve', 'refund']);
    } finally {
      mem.capture = realCapture;
    }
  });

  await test('a refund that cannot be recorded leaves the reservation PENDING (never lost) for reconciliation, and never throws to the caller', async () => {
    await reset();
    fake.mode = 'error400';
    const realRefund = mem.refund.bind(mem);
    mem.refund = async () => {
      throw new Error('database unavailable during refund');
    };
    try {
      const { body } = await generate();
      assert.equal((await waitDone(body.jobId, 'token-a')).stage, 'error');
      const pendingNow = (await mem.pending(0, USER_A)).filter((p) => p.generationId === body.jobId);
      assert.equal(pendingNow.length, 1);
      assert.equal(await bal(), 100 - COST);
    } finally {
      mem.refund = realRefund;
    }
    const { reconcileStaleReservations } = await import('../src/services/walletReconciler');
    const s = await reconcileStaleReservations({ olderThanSeconds: 0, userId: USER_A });
    assert.ok(s.refunded >= 1);
    assert.equal(await bal(), 100);
  });

  // ---------------------------------------------------------------- inputs
  await test('unauthenticated and invalid-token requests are rejected with 401 and cost nothing', async () => {
    await reset();
    assert.equal((await post(null, multipart(baseFields(), floorplan))).status, 401);
    assert.equal((await post('bad-token', multipart(baseFields(), floorplan))).status, 401);
    assert.equal((await fetch(`${base}/history`)).status, 401);
    assert.equal(fake.edits.length, 0);
    assert.equal(await bal(), 100);
  });

  await test('invalid file bytes / missing plan / invalid style reference / oversized file are rejected before any charge', async () => {
    await reset();
    assert.equal((await generate({}, { image: { data: Buffer.from('this is not an image'), name: 'x.png' } })).status, 400);
    assert.equal((await generate({}, {})).status, 400);
    assert.equal((await generate({}, { ...floorplan, styleReference: { data: Buffer.from('nope'), name: 'ref.png' } })).status, 400);
    const big = await generate({}, { image: { data: Buffer.concat([PNG, Buffer.alloc(16 * 1024 * 1024)]), name: 'big.png' } });
    assert.equal(big.status, 413);
    assert.equal(big.body.error.code, 'FILE_TOO_LARGE');
    assert.equal(await bal(), 100);
  });

  await test('the stored file type comes from the bytes, not from the client-declared name/extension; the object path never contains the client name', async () => {
    await reset();
    const { body } = await generate({}, { image: { data: PNG, name: '../../evil<script>.jpg' } });
    await waitDone(body.jobId, 'token-a');
    const rec = await store.get(USER_A, body.jobId);
    assert.equal(rec!.originalPath, `${USER_A}/${body.jobId}/original.png`);
    assert.ok(!rec!.originalFileName!.includes('..') && !/[<>/\\]/.test(rec!.originalFileName!));
    assert.equal(filesMod.buildObjectPath(USER_A, body.jobId, 'result', 'image/png'), `${USER_A}/${body.jobId}/result.png`);
    assert.throws(() => filesMod.buildObjectPath('../x', body.jobId, 'result', 'image/png'));
    assert.throws(() => filesMod.buildObjectPath(USER_A, body.jobId, 'result', 'text/html'));
  });

  await test('invalid enum values and a missing idempotency key are rejected before any charge', async () => {
    await reset();
    assert.equal((await generate({ lighting: 'disco' })).status, 400);
    assert.equal((await generate({ style: 'gothic' })).status, 400);
    assert.equal((await post('token-a', multipart({ style: 'contemporaneo' }, floorplan))).status, 400);
    assert.equal(await bal(), 100);
  });

  // ---------------------------------------------------------------- reference + options
  await test('style reference: provider receives TWO images and the prompt limits the reference to visual style; record shows hasReference', async () => {
    await reset();
    const { body } = await generate({}, { ...floorplan, styleReference: { data: PNG, name: 'referencia.png' } });
    await waitDone(body.jobId, 'token-a');
    const raw = fake.edits[0];
    assert.equal((raw.match(/filename="/g) ?? []).length, 2);
    assert.ok(raw.includes('SECOND image is a style reference ONLY'));
    const rec = await store.get(USER_A, body.jobId);
    assert.equal(rec!.hasReference, true);
    assert.equal(rec!.referenceFileName, 'referencia.png');
    assert.equal(rec!.referencePath, `${USER_A}/${body.jobId}/style-reference.png`);
  });

  await test('without a reference: exactly one image is sent and there is no reference section', async () => {
    await reset();
    const { body } = await generate();
    await waitDone(body.jobId, 'token-a');
    assert.equal((fake.edits[0].match(/filename="/g) ?? []).length, 1);
    assert.ok(!fake.edits[0].includes('STYLE REFERENCE'));
  });

  await test('every lighting option maps to its own prompt phrase; clear_day is the default', () => {
    const opts = { style: 'contemporaneo', surroundings: 'auto', surroundingsKind: null, customSurroundings: null, textMode: 'auto', furnitureLevel: 'auto', outputFormat: 'original', hasStyleReference: false, customInstructions: null } as const;
    const seen = new Set<string>();
    for (const l of styles.HUMANIZED_FLOORPLAN_LIGHTING_OPTIONS) {
      const p = promptMod.buildHumanizedFloorplanPrompt({ ...opts, lighting: l });
      assert.ok(p.includes(styles.HUMANIZED_FLOORPLAN_LIGHTING_PHRASES[l]));
      seen.add(styles.HUMANIZED_FLOORPLAN_LIGHTING_PHRASES[l]);
    }
    assert.equal(seen.size, 4);
    assert.equal(parseSettings({ style: 'contemporaneo' }).lighting, 'clear_day');
  });

  await test('every surroundings option produces its own guarded prompt rule; default is auto', () => {
    const opts = { style: 'tropical', lighting: 'clear_day', textMode: 'auto', furnitureLevel: 'auto', outputFormat: 'original', hasStyleReference: false, customInstructions: null } as const;
    const build = (surroundings: any, kind: any, custom: string | null) => promptMod.buildHumanizedFloorplanPrompt({ ...opts, surroundings, surroundingsKind: kind, customSurroundings: custom });
    assert.ok(build('none', null, null).includes('clean and empty'));
    assert.ok(build('auto', null, null).includes('choose an exterior treatment'));
    for (const kind of ['lawn', 'forest', 'neighborhood', 'houses'] as const) {
      const p = build('with', kind, null);
      assert.ok(p.includes(styles.HUMANIZED_FLOORPLAN_SURROUNDINGS_KIND_PHRASES[kind]), kind);
      assert.ok(p.includes('never cover walls'));
    }
    assert.ok(build('with', 'custom', 'a river and a red barn').includes('a river and a red barn'));
    assert.equal(parseSettings({ style: 'contemporaneo' }).surroundings, 'auto');
  });

  await test('custom surroundings, advanced settings and output format reach the provider request end-to-end', async () => {
    await reset();
    const { body } = await generate({ surroundings: 'with', surroundingsKind: 'custom', customSurroundings: 'a river and a red barn', textMode: 'remove', furnitureLevel: 'essential', outputFormat: 'landscape' });
    await waitDone(body.jobId, 'token-a');
    const raw = fake.edits[0];
    assert.ok(raw.includes('a river and a red barn'));
    assert.ok(raw.includes('remove text labels'));
    assert.ok(raw.includes('essential pieces only'));
    assert.ok(/name="size"\r\n\r\n1536x1024/.test(raw));
    assert.equal(styles.HUMANIZED_FLOORPLAN_OUTPUT_FORMAT_SIZES.original, null);
  });

  await test('prompt: architecture first, all negative rules present, user instructions last and subordinate', () => {
    const p = promptMod.buildHumanizedFloorplanPrompt({ style: 'industrial', lighting: 'night', surroundings: 'auto', surroundingsKind: null, customSurroundings: null, textMode: 'auto', furnitureLevel: 'auto', outputFormat: 'original', hasStyleReference: true, customInstructions: 'move the kitchen wall' });
    const idx = (s: string) => p.indexOf(s);
    assert.ok(idx('PRIORITY 1') < idx('PRIORITY 2') && idx('PRIORITY 2') < idx('PRIORITY 3') && idx('PRIORITY 6') < idx('PRIORITY 7'));
    for (const rule of promptMod.HUMANIZED_FLOORPLAN_NEGATIVE_RULES) assert.ok(p.includes(rule), rule);
    assert.ok(p.includes('ignore any part that would alter the architecture'));
  });

  // ---------------------------------------------------------------- history / ownership / downloads
  await test('history returns ONLY the caller\'s generations, and exposes no prompt, cost, usage, provider payload, storage path or ledger internals', async () => {
    await reset();
    const a = await generate({}, floorplan, 'token-a');
    const b = await generate({}, floorplan, 'token-b');
    await waitDone(a.body.jobId, 'token-a');
    await waitDone(b.body.jobId, 'token-b');
    const histA = (await getJson('/history', 'token-a')).body.items as any[];
    const histB = (await getJson('/history', 'token-b')).body.items as any[];
    assert.ok(histA.some((i) => i.id === a.body.jobId) && !histA.some((i) => i.id === b.body.jobId));
    assert.ok(histB.some((i) => i.id === b.body.jobId) && !histB.some((i) => i.id === a.body.jobId));
    const serialized = JSON.stringify(histA) + JSON.stringify((await getJson(`/${a.body.jobId}`, 'token-a')).body);
    for (const forbidden of ['prompt', 'costUsd', 'usage', 'originalPath', 'resultPath', 'referencePath', 'requestId', 'provider', 'reservationId', 'idempotencyKey', 'fake-openai-key', 'userId', USER_A, USER_B]) {
      assert.ok(!serialized.includes(forbidden.startsWith('"') ? forbidden : forbidden.includes('-') ? forbidden : `"${forbidden}"`), `history must not expose ${forbidden}`);
    }
  });

  await test('another user cannot read, poll, delete or reuse (new version) a generation they do not own — and a refused reuse costs them nothing', async () => {
    await reset();
    const a = await generate({}, floorplan, 'token-a');
    await waitDone(a.body.jobId, 'token-a');
    assert.equal((await getJson(`/${a.body.jobId}`, 'token-b')).status, 404);
    assert.equal((await fetch(`${base}/${a.body.jobId}`, { method: 'DELETE', headers: { Authorization: 'Bearer token-b' } })).status, 404);
    const before = { edits: fake.edits.length, balanceB: await bal(USER_B) };
    const reuse = await post('token-b', multipart({ ...baseFields(), sourceGenerationId: a.body.jobId }));
    assert.equal(reuse.status, 404);
    assert.equal(fake.edits.length, before.edits);
    assert.equal(await bal(USER_B), before.balanceB);
    assert.equal((await store.get(USER_A, a.body.jobId))!.status, 'completed');
    assert.equal(filesMod.verifyFileToken('x.y'), null);
  });

  await test('file/URL storage: only signed links are exposed; tampered/expired/garbage tokens are refused; no public path is served', async () => {
    await reset();
    const good = filesMod.createFileToken(`${USER_A}/does-not-matter/result.png`);
    assert.ok(filesMod.verifyFileToken(good));
    assert.equal(filesMod.verifyFileToken(good.slice(0, -2) + 'xx'), null);
    assert.equal(filesMod.verifyFileToken(filesMod.createFileToken('a/b/c.png', 1000, Date.now() - 5000)), null);
    assert.equal((await fetch(`${base}/file?token=garbage`)).status, 403);
    assert.equal(filesMod.isSafePathSegment('../../etc'), false);
    assert.equal((await fetch(`${appOrigin}/results/anything.png`)).status, 404);
  });

  await test('downloads: PNG keeps the original bytes with an organized filename; JPG is a real stored JPEG; both need the ownership-checked detail call to obtain links', async () => {
    await reset();
    const { body } = await generate();
    await waitDone(body.jobId, 'token-a');
    assert.equal(((await getJson('/history', 'token-a')).body.items as any[])[0].downloadPngUrl, null, 'the list only signs thumbnails');
    const item = (await getJson(`/${body.jobId}`, 'token-a')).body.item;
    const png = await fetch(`${appOrigin}${item.downloadPngUrl}`);
    assert.equal(png.status, 200);
    assert.equal(png.headers.get('content-type'), 'image/png');
    assert.match(png.headers.get('content-disposition') ?? '', new RegExp(`planta-humanizada-\\d{4}-\\d{2}-\\d{2}-${body.jobId.slice(0, 8)}\\.png`));
    assert.deepEqual(Buffer.from(await png.arrayBuffer()), PNG);
    const jpg = await fetch(`${appOrigin}${item.downloadJpgUrl}`);
    assert.equal(jpg.status, 200);
    assert.equal(jpg.headers.get('content-type'), 'image/jpeg');
    assert.match(jpg.headers.get('content-disposition') ?? '', /\.jpg"/);
    const jb = Buffer.from(await jpg.arrayBuffer());
    assert.equal(jb[0], 0xff);
    assert.equal(jb[1], 0xd8);
  });

  await test('create new version / repeat settings: reuses the STORED original (no re-upload), is a separate generation, charges 2 more', async () => {
    await reset();
    const first = await generate({ style: 'escandinavo', lighting: 'golden_hour' });
    await waitDone(first.body.jobId, 'token-a');
    const again = await post('token-a', multipart({ style: 'escandinavo', lighting: 'golden_hour', idempotencyKey: newKey(), sourceGenerationId: first.body.jobId }));
    assert.equal(again.status, 202);
    const j = (await again.json()) as any;
    assert.notEqual(j.jobId, first.body.jobId);
    await waitDone(j.jobId, 'token-a');
    assert.equal(await bal(), 100 - 2 * COST);
    assert.equal(fake.edits.length, 2);
    const rec = await store.get(USER_A, j.jobId);
    assert.equal(rec!.sourceGenerationId, first.body.jobId);
    assert.equal(rec!.originalPath, `${USER_A}/${j.jobId}/original.png`, 'the copy lives under the NEW generation, owned by the same user');
  });

  await test('"repeat with the same reference" reuses the stored reference; omitting the flag drops it', async () => {
    await reset();
    const first = await generate({}, { ...floorplan, styleReference: { data: PNG, name: 'ref.png' } });
    await waitDone(first.body.jobId, 'token-a');
    const kept = (await (await post('token-a', multipart({ style: 'contemporaneo', idempotencyKey: newKey(), sourceGenerationId: first.body.jobId, reuseSourceReference: '1' }))).json()) as any;
    await waitDone(kept.jobId, 'token-a');
    assert.equal((await store.get(USER_A, kept.jobId))!.hasReference, true);
    const dropped = (await (await post('token-a', multipart({ style: 'contemporaneo', idempotencyKey: newKey(), sourceGenerationId: first.body.jobId }))).json()) as any;
    await waitDone(dropped.jobId, 'token-a');
    assert.equal((await store.get(USER_A, dropped.jobId))!.hasReference, false);
  });

  await test('delete from history: 200, hidden, files removed, ledger movements kept for audit; unknown id is 404; in-progress cannot be deleted', async () => {
    await reset();
    const { body } = await generate();
    await waitDone(body.jobId, 'token-a');
    const rec = await store.get(USER_A, body.jobId);
    const resultFile = path.join(filesRoot, rec!.resultPath!);
    assert.ok(fs.existsSync(resultFile));
    assert.equal((await fetch(`${base}/${body.jobId}`, { method: 'DELETE', headers: { Authorization: 'Bearer token-a' } })).status, 200);
    assert.ok(!fs.existsSync(resultFile));
    assert.ok(!((await getJson('/history', 'token-a')).body.items as any[]).some((i) => i.id === body.jobId));
    assert.equal((await getJson(`/${body.jobId}`, 'token-a')).status, 404);
    assert.deepEqual(await kinds(USER_A, body.jobId), ['reserve', 'capture'], 'the financial trail survives deletion');
    assert.equal((await fetch(`${base}/99999999-9999-4999-8999-999999999999`, { method: 'DELETE', headers: { Authorization: 'Bearer token-a' } })).status, 404);
  });

  await test('legacy/partial records (missing newer fields) still load in history without crashing', async () => {
    await reset();
    const legacyPath = path.join(tmpDir, 'legacy.json');
    fs.writeFileSync(legacyPath, JSON.stringify([{ id: '33333333-3333-4333-8333-333333333333', userId: USER_A, status: 'completed', style: 'classico', createdAt: '2026-01-01T00:00:00.000Z', resultPath: null, originalPath: null, referencePath: null }]));
    storeMod.setGenerationStoreForTests(new storeMod.LocalGenerationStore(legacyPath));
    const hist = await getJson('/history', 'token-a');
    storeMod.setGenerationStoreForTests(store);
    assert.equal(hist.status, 200);
    assert.equal(hist.body.items.length, 1);
    assert.equal(hist.body.items[0].thumbnailUrl, null);
  });

  await test('job-creation log records the generation with no sensitive data', () => {
    const jobId = 'test-job-id-' + Date.now();
    logJobCreation({ route: '/generate-humanized-floorplan-simple', jobId, idempotencyKey: 'idem-test-key', reusedExistingJob: false, ip: '127.0.0.1', userAgent: 'test-agent' });
    assert.ok(readJobCreationLog().find((e) => e.jobId === jobId));
    const rawFile = fs.readFileSync(getJobCreationLogPath(), 'utf8');
    assert.ok(!/sk-[A-Za-z0-9]/.test(rawFile) && !/iVBORw0KGgo/.test(rawFile));
  });

  await test('PNG validation accepts a real PNG and rejects garbage', () => {
    assert.equal(validation.validateGeneratedFloorplanPng(PNG).valid, true);
    assert.equal(validation.validateGeneratedFloorplanPng(Buffer.from('nope')).valid, false);
  });

  // ---------------------------------------------------------------- structural guarantees
  const readSrc = (p: string) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  await test('the Planta Humanizada route never writes to public/results and no longer uses the shared result store', () => {
    const src = stripComments(readSrc('src/routes/generateHumanizedFloorplanSimple.ts'));
    assert.ok(!/saveResultImage|public\/results|public['"],\s*['"]results/.test(src));
    assert.ok(!/resultStore/.test(src));
  });

  await test('the primary route imports no OpenCV / Vision / Gemini / FLUX / advanced-route module and never touches VISION_PROVIDER', () => {
    const src = readSrc('src/routes/generateHumanizedFloorplanSimple.ts');
    const imports = src.split('\n').filter((l) => l.startsWith('import ') || l.startsWith("} from '")).join('\n').toLowerCase();
    for (const banned of ['opencv', 'floorplanmask', 'floorplanfurniture', 'openaivision', 'gemini', 'bflfill', 'textcorrection', "generatehumanizedfloorplan'"]) assert.ok(!imports.includes(banned), banned);
    assert.ok(!src.includes('VISION_PROVIDER'));
  });

  await test('the provider never logs the API key, headers or base64, never hardcodes the model, and never sends input_fidelity', () => {
    const provider = readSrc('src/providers/openaiBlockImage.ts');
    const fn = provider.slice(provider.indexOf('export async function generateHumanizedFloorplanImage'));
    assert.ok(!/apiKey|headers|Authorization/i.test(fn));
    assert.ok(!/logger\.(log|error)\([^)]*(b64|base64)/i.test(fn));
    assert.ok(!/gpt-image/.test(fn));
    assert.ok(!fn.includes('input_fidelity: '));
  });

  appServer.close();
  fakeServer.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
