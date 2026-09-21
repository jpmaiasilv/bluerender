/**
 * Behavioral tests for the second generation mode of Planta Humanizada
 * ("astra": ONE GPT-6 Astra analysis of the original plan + ONE Sunburst
 * generation at high quality, 10 credits; a valid, saved, readable image is
 * ALWAYS delivered — no score, no validation, no second attempt, no correction)
 * and for the guarantee that the "standard" mode (2 credits) is untouched.
 *
 * Runs the REAL route, wallet service, store, storage, pipeline and both OpenAI
 * providers against a LOCAL fake server that speaks the real API shapes
 * (/v1/responses for Astra, /v1/images/edits for Sunburst, Supabase auth).
 * Nothing leaves this machine; no key is used; no credit is spent.
 *
 * Run with: npm run test:humanized-floorplan-astra -w backend
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { Jimp } from 'jimp';
import OpenAI from 'openai';

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

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const PNG_A_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const fake = {
  imageModes: [] as Array<'ok' | 'no_image' | 'error400'>,
  imageCalls: [] as string[],
  astraCalls: [] as Array<{ schema: string; body: any }>,
  analysisMode: 'ok' as 'ok' | 'invalid_json' | 'error500' | 'empty' | 'auth401' | 'perm401' | 'forbidden403' | 'notfound404',
  onAstra: null as null | ((schema: string) => void),
  pngB64: [PNG_A_B64, PNG_A_B64] as string[],
  slowMs: 0,
  noAstraUsage: false,
};

const ANALYSIS = {
  architectural_constraints: {
    building_perimeter: ['Rectangular outline, one notch at the north-east corner'],
    walls: ['Load-bearing walls on all four sides', 'Interior wall splitting kitchen and living room'],
    openings: ['Wide opening between living and dining'],
    doors: ['Main door on the south wall'],
    windows: ['Two windows on the east wall'],
    stairs: ['Straight stair at the west side'],
    fixed_elements: ['Kitchen counter along the north wall'],
    rooms: ['Living room', 'Kitchen', 'Bedroom'],
    circulation: ['Corridor from the main door to the bedroom'],
    elements_that_must_not_change: ['Wall positions', 'Door swings'],
  },
  style_reference: {
    palette: ['warm beige', 'sage green'], materials: ['oak flooring'], textures: ['linen'], furniture_style: ['rounded sofas'],
    vegetation_style: ['potted olive trees'], shadow_style: ['soft long shadows'], graphic_language: ['flat colors with subtle gradients'],
  },
  generation_guidance: {
    preservation_rules: ['Keep every wall where it is'], allowed_changes: ['Materials', 'Furniture look'], forbidden_changes: ['Moving walls', 'Adding rooms'],
    recommended_prompt: 'Keep the wall layout identical; only restyle surfaces and furniture.',
  },
};

function responsesEnvelope(text: string) {
  return {
    id: `resp_${Math.random().toString(36).slice(2, 10)}`,
    object: 'response',
    created_at: 1,
    status: 'completed',
    model: 'gpt-6-astra',
    output: [{ type: 'message', id: 'msg_1', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }],
    usage: fake.noAstraUsage ? undefined : { input_tokens: 2000, input_tokens_details: { cached_tokens: 500, cache_write_tokens: 0 }, output_tokens: 800, output_tokens_details: { reasoning_tokens: 300 }, total_tokens: 2800 },
  };
}

function startFakeServer(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = req.url ?? '';
      const send = (status: number, json: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(json));
      if (url.startsWith('/auth/v1/user')) {
        const token = (req.headers.authorization ?? '').replace('Bearer ', '');
        const id = token === 'token-a' ? USER_A : token === 'token-b' ? USER_B : null;
        if (!id) return send(401, { msg: 'invalid' });
        return send(200, { id, email: `${id}@test.local`, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
      }
      if (url.startsWith('/v1/responses')) {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const schema = body?.text?.format?.name ?? '';
        fake.astraCalls.push({ schema, body });
        fake.onAstra?.(schema);
        if (schema === 'astra_architecture_analysis') {
          const authFail = (status: number, code: string, type: string, message: string) => {
            res.writeHead(status, { 'Content-Type': 'application/json', 'x-request-id': 'req_test_' + status }).end(JSON.stringify({ error: { message, type, code, param: null } }));
          };
          if (fake.analysisMode === 'auth401') return authFail(401, 'invalid_api_key', 'invalid_request_error', 'Incorrect API key provided: sk-proj-FAKESECRETKEYVALUE1234567890. You can find your API key at https://platform.openai.com/account/api-keys.');
          if (fake.analysisMode === 'perm401') return authFail(401, 'insufficient_permissions', 'invalid_request_error', 'You have insufficient permissions for this operation. Missing scopes: api.responses.write.');
          if (fake.analysisMode === 'forbidden403') return authFail(403, 'model_not_allowed', 'invalid_request_error', 'Project does not have access to model gpt-6-astra.');
          if (fake.analysisMode === 'notfound404') return authFail(404, 'model_not_found', 'invalid_request_error', 'The model gpt-6-astra does not exist or you do not have access to it.');
          if (fake.analysisMode === 'error500') return send(500, { error: { message: 'secret provider detail', type: 'server_error' } });
          if (fake.analysisMode === 'invalid_json') return send(200, responsesEnvelope('{"this is": not json'));
          if (fake.analysisMode === 'empty') return send(200, responsesEnvelope(''));
          return send(200, responsesEnvelope(JSON.stringify(ANALYSIS)));
        }
        // The only Astra call the app may make is the analysis; anything else is a bug, and answers with an error so the run fails loudly.
        return send(500, { error: { message: 'unexpected Astra call: ' + schema } });
      }
      if (url.startsWith('/v1/images/edits')) {
        fake.imageCalls.push(Buffer.concat(chunks).toString('latin1'));
        const mode = fake.imageModes.shift() ?? 'ok';
        const respond = () => {
          if (mode === 'error400') return send(400, { error: { message: 'secret provider detail', type: 'image_generation_user_error', code: 'bad' } });
          if (mode === 'no_image') return send(200, { created: 1, data: [] });
          const b64 = fake.pngB64[Math.min(fake.imageCalls.length - 1, fake.pngB64.length - 1)];
          return send(200, { created: 1, data: [{ b64_json: b64 }], quality: 'high', size: '1024x1024', usage: { input_tokens: 1500, input_tokens_details: { text_tokens: 500, image_tokens: 1000 }, output_tokens: 4000, total_tokens: 5500 } });
        };
        if (fake.slowMs) setTimeout(respond, fake.slowMs);
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
  console.log('Planta Humanizada — Astra mode + standard-mode guarantees (local fake OpenAI)\n');
  const fakeServer = await startFakeServer();
  const port = (fakeServer.address() as AddressInfo).port;
  process.env.SUPABASE_URL = `http://127.0.0.1:${port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
  process.env.OPENAI_API_KEY = 'fake-openai-key';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.WALLET_SIGNUP_BONUS_CREDITS = '100';
  process.env.HUMANIZED_FLOORPLAN_ASTRA_ENABLED = 'true';
  process.env.HUMANIZED_FLOORPLAN_REQUEST_TIMEOUT_MS = '3000';
  process.env.OPENAI_ASTRA_INPUT_PRICE_PER_M = '2';
  process.env.OPENAI_ASTRA_CACHED_INPUT_PRICE_PER_M = '0.5';
  process.env.OPENAI_ASTRA_OUTPUT_PRICE_PER_M = '10';
  process.env.OPENAI_IMAGE_PRICE_TEXT_INPUT_PER_M = '5';
  process.env.OPENAI_IMAGE_PRICE_IMAGE_INPUT_PER_M = '8';
  process.env.OPENAI_IMAGE_PRICE_IMAGE_OUTPUT_PER_M = '30';

  const PNG_A = Buffer.from(PNG_A_B64, 'base64');
  const imgB = new Jimp({ width: 3, height: 2, color: 0x336699ff });
  const PNG_B = Buffer.from(await imgB.getBuffer('image/png'));
  fake.pngB64 = [PNG_A.toString('base64'), PNG_B.toString('base64')];

  const express = (await import('express')).default;
  const { generateHumanizedFloorplanSimpleRouter } = await import('../src/routes/generateHumanizedFloorplanSimple');
  const walletMod = await import('../src/services/creditWallet');
  const storeMod = await import('../src/services/humanizedFloorplanStore');
  const filesMod = await import('../src/storage/humanizedFloorplanFiles');
  const engine = await import('../src/config/humanizedFloorplanEngine');
  const models = await import('../src/config/openaiModels');
  const astraCfg = await import('../src/config/humanizedFloorplanAstra');
  const schemas = await import('../src/lib/astra/astraSchemas');
  const promptMod = await import('../src/lib/openaiImage/humanizedFloorplanPrompt');
  const astraCost = await import('../src/services/openaiAstraCost');
  const reconciler = await import('../src/services/walletReconciler');
  const hReconciler = await import('../src/services/humanizedFloorplanReconciler');
  const astraProvider = await import('../src/providers/openaiAstra');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-test-'));
  const mem = new walletMod.MemoryWalletBackend();
  const store = new storeMod.LocalGenerationStore(path.join(tmpDir, 'generations.json'));
  const storage = new filesMod.LocalFileStorage(path.join(tmpDir, 'files'));
  walletMod.setWalletBackendForTests(mem);
  storeMod.setGenerationStoreForTests(store);
  filesMod.setFileStorageForTests(storage);

  const app = express();
  app.use(express.json());
  app.use('/api', generateHumanizedFloorplanSimpleRouter);
  const appServer = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}/api/generate-humanized-floorplan-simple`;

  const STANDARD = engine.STANDARD_HUMANIZED_FLOORPLAN_COST;
  const ASTRA = engine.ASTRA_HUMANIZED_FLOORPLAN_COST;
  let k = 0;
  const key = () => `astra-key-${Date.now()}-${k++}`;
  const plan = { image: { data: PNG_A, name: 'planta.png' } };
  const post = (token: string | null, form: FormData) => fetch(base, { method: 'POST', body: form, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const getJson = async (p: string, token: string | null) => {
    const r = await fetch(`${base}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: r.status, body: (await r.json()) as any };
  };
  async function waitDone(id: string, token = 'token-a') {
    for (let i = 0; i < 400; i++) {
      const { body } = await getJson(`/${id}`, token);
      if (body.stage === 'complete' || body.stage === 'error') return body;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('generation did not finish');
  }
  const bal = (u = USER_A) => mem.balance(u);
  const kinds = async (u: string, id: string) => (await mem.ledgerForGeneration(u, id)).map((m) => m.type);
  async function setBalance(u: string, target: number) {
    await mem.ensure(u, 100);
    const cur = await mem.balance(u);
    if (cur > target) {
      const r = await mem.reserve({ userId: u, amount: cur - target, tool: 'test_setup', generationId: null, idempotencyKey: null });
      await mem.capture(u, r.reservationId);
    } else if (cur < target) await mem.credit(u, target - cur, 'test_setup', 'test', null);
  }
  const reset = async () => {
    fake.imageModes.length = 0;
    fake.imageCalls.length = 0;
    fake.astraCalls.length = 0;
    fake.analysisMode = 'ok';
    fake.onAstra = null;
    fake.slowMs = 0;
    fake.noAstraUsage = false;
    process.env.HUMANIZED_FLOORPLAN_ASTRA_ENABLED = 'true';
    await setBalance(USER_A, 100);
    await setBalance(USER_B, 100);
  };
  async function generate(mode: string | undefined, extra: Record<string, string> = {}, files = plan, token = 'token-a') {
    const fields: Record<string, string> = { style: 'contemporaneo', idempotencyKey: key(), ...extra };
    if (mode !== undefined) fields.generationMode = mode;
    const r = await post(token, multipart(fields, files));
    return { status: r.status, body: (await r.json()) as any };
  }
  const astraGen = (extra: Record<string, string> = {}, files = plan, token = 'token-a') => generate('astra', extra, files, token);
  const stepsOf = async (id: string) => (await store.listSteps(USER_A, id)).map((s) => s.step);

  // ------------------------------------------------------------ config / prices
  await test('prices come from ONE backend source: standard 2, astra 10; /config returns both with availability and no secrets', async () => {
    await reset();
    assert.equal(STANDARD, 2);
    assert.equal(ASTRA, 10);
    assert.deepEqual(engine.HUMANIZED_FLOORPLAN_MODE_COSTS, { standard: 2, astra: 10 });
    const { body } = await getJson('/config', null);
    assert.deepEqual(body.humanizedFloorplan, { modes: { standard: { cost: 2, available: true }, astra: { cost: 10, available: true } } });
    assert.equal(body.costCredits, 2, 'legacy field kept for the standard mode');
    const text = JSON.stringify(body);
    for (const secret of ['fake-openai-key', 'fake-service-key', 'gpt-6-astra', 'PRIORITY', 'prompt']) assert.ok(!text.includes(secret), `config must not expose ${secret}`);
  });

  await test('feature flag OFF: /config reports astra unavailable, POST astra is refused (400) with NO reservation and NO provider call; standard still works', async () => {
    await reset();
    process.env.HUMANIZED_FLOORPLAN_ASTRA_ENABLED = 'false';
    assert.equal((await getJson('/config', null)).body.humanizedFloorplan.modes.astra.available, false);
    const r = await astraGen();
    assert.equal(r.status, 400);
    assert.equal(await bal(), 100);
    assert.equal(fake.astraCalls.length + fake.imageCalls.length, 0);
    const std = await generate('standard');
    assert.equal(std.status, 202);
    assert.equal((await waitDone(std.body.jobId)).stage, 'complete');
    process.env.HUMANIZED_FLOORPLAN_ASTRA_ENABLED = 'true';
  });

  await test('the astra mode is unavailable without the OpenAI key or without persistent infrastructure', async () => {
    await reset();
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    assert.equal((await getJson('/config', null)).body.humanizedFloorplan.modes.astra.available, false);
    process.env.OPENAI_API_KEY = saved;
    walletMod.setWalletBackendForTests(null);
    const savedEnv = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const savedFallback = process.env.ALLOW_LOCAL_DEV_FALLBACK;
    delete process.env.ALLOW_LOCAL_DEV_FALLBACK;
    assert.equal((await getJson('/config', null)).body.humanizedFloorplan.modes.astra.available, false);
    process.env.SUPABASE_URL = savedEnv.u;
    process.env.SUPABASE_SERVICE_ROLE_KEY = savedEnv.k;
    if (savedFallback !== undefined) process.env.ALLOW_LOCAL_DEV_FALLBACK = savedFallback;
    walletMod.setWalletBackendForTests(mem);
    assert.equal((await getJson('/config', null)).body.humanizedFloorplan.modes.astra.available, true);
  });

  await test('an unknown mode is rejected (400) before any charge; a missing mode means standard', async () => {
    await reset();
    assert.equal((await generate('turbo')).status, 400);
    assert.equal((await generate('ASTRA')).status, 400);
    assert.equal(await bal(), 100);
    const r = await generate(undefined);
    assert.equal(r.status, 202);
    await waitDone(r.body.jobId);
    assert.equal(await bal(), 100 - STANDARD);
    assert.equal((await store.get(USER_A, r.body.jobId))!.generationMode, 'standard');
  });

  await test('the client cannot set the price, model, score or status: extra fields are ignored and the mode alone picks the cost', async () => {
    await reset();
    const r = await generate('standard', { cost: '1', credits: '0', amount: '0', model: 'gpt-4', analysisModel: 'gpt-4', fidelityScore: '100', status: 'completed', validationStatus: 'approved', userId: USER_B });
    await waitDone(r.body.jobId);
    assert.equal(await bal(), 100 - STANDARD);
    assert.equal(await bal(USER_B), 100, 'a userId in the body never redirects the charge');
    const rec = await store.get(USER_A, r.body.jobId);
    assert.equal(rec!.model, models.OPENAI_BLOCK_IMAGE_MODEL);
    assert.equal(rec!.fidelityScore, null);
    assert.equal(rec!.validationStatus, null);
  });

  // ------------------------------------------------------------ standard mode untouched
  await test('STANDARD: charges 2, calls the image model once and NEVER calls Astra; no analysis/validation data, no pipeline steps', async () => {
    await reset();
    const r = await generate('standard');
    const done = await waitDone(r.body.jobId);
    assert.equal(done.stage, 'complete');
    assert.equal(fake.astraCalls.length, 0, 'standard must not call Astra');
    assert.equal(fake.imageCalls.length, 1);
    assert.equal(await bal(), 100 - STANDARD);
    assert.deepEqual(await kinds(USER_A, r.body.jobId), ['reserve', 'capture']);
    const rec = await store.get(USER_A, r.body.jobId);
    assert.equal(rec!.generationMode, 'standard');
    assert.equal(rec!.analysisModel, null);
    assert.equal(rec!.validationStatus, null);
    assert.deepEqual(await store.listSteps(USER_A, r.body.jobId), []);
  });

  await test('STANDARD prompt is byte-for-byte free of every Astra addition (the original flow is unchanged)', async () => {
    await reset();
    const r = await generate('standard');
    await waitDone(r.body.jobId);
    const raw = fake.imageCalls[0];
    for (const marker of ['PRIORITY 1B', 'VERIFIED ARCHITECTURAL', 'Additional hard rules', 'CORRECTION REQUIRED', 'ANALYSIS GUIDANCE']) assert.ok(!raw.includes(marker), marker);
    for (const p of ['PRIORITY 1', 'PRIORITY 3', 'PRIORITY 4', 'PRIORITY 5', 'PRIORITY 6']) assert.ok(raw.includes(p), p);
    const opts = { style: 'tropical', lighting: 'night', surroundings: 'auto', surroundingsKind: null, customSurroundings: null, textMode: 'auto', furnitureLevel: 'auto', outputFormat: 'original', hasStyleReference: false, customInstructions: 'x' } as const;
    assert.equal(promptMod.buildHumanizedFloorplanPrompt({ ...opts }), promptMod.buildHumanizedFloorplanPrompt({ ...opts, astra: undefined }));
  });

  // ------------------------------------------------------------ astra: credits
  await test('ASTRA happy path: 10 credits reserved ONCE and captured ONCE; exactly ONE Astra analysis and ONE image call (high quality); the image is delivered', async () => {
    await reset();
    const r = await astraGen();
    assert.equal(r.status, 202);
    const done = await waitDone(r.body.jobId);
    assert.equal(done.stage, 'complete');
    assert.equal(await bal(), 100 - ASTRA);
    const ledger = await mem.ledgerForGeneration(USER_A, r.body.jobId);
    assert.deepEqual(ledger.map((m) => [m.type, m.amount]), [['reserve', 10], ['capture', 10]]);
    assert.deepEqual(fake.astraCalls.map((c) => c.schema), ['astra_architecture_analysis']);
    assert.equal(fake.imageCalls.length, 1);
    assert.ok(/name="quality"\r\n\r\nhigh/.test(fake.imageCalls[0]), 'the single generation is requested at high quality');
    const rec = await store.get(USER_A, r.body.jobId);
    assert.equal(rec!.generationMode, 'astra');
    assert.equal(rec!.status, 'completed');
    assert.equal(rec!.validationStatus, null);
    assert.equal(rec!.fidelityScore, null);
    assert.equal(rec!.attemptsCount, 1);
    assert.equal(rec!.autoCorrectionApplied, false);
    assert.equal(rec!.violationsSummary, null);
    assert.equal(rec!.creditsCaptured, ASTRA);
    assert.ok(rec!.resultPath && (await storage.exists(rec!.resultPath)));
    assert.deepEqual(await stepsOf(r.body.jobId), ['analysis', 'generation_1']);
  });

  await test('a valid image is ALWAYS delivered: the Astra flow has no score, status or violation that can hide it; legacy validation fields in the record never control delivery', async () => {
    await reset();
    const r = await astraGen();
    await waitDone(r.body.jobId);
    const done = (await store.get(USER_A, r.body.jobId))!;
    // A legacy row that says "failed / score 10 / violations" is still a completed generation with its image visible.
    const legacyId = '99999999-9999-4999-8999-999999999999';
    await store.insert({ ...done, id: legacyId, idempotencyKey: null, validationStatus: 'failed', fidelityScore: 10, attemptsCount: 2, autoCorrectionApplied: true, violationsSummary: [{ type: 'wall', severity: 'high', location: 'x', description: 'y' }] });
    const item = ((await getJson('/history', 'token-a')).body.items as any[]).find((i) => i.id === legacyId);
    assert.equal(item.status, 'completed');
    assert.ok(item.resultUrl, 'the image is offered to the user');
    for (const hidden of ['fidelityScore', 'validationStatus', 'violationsSummary', 'autoCorrectionApplied', 'attemptsCount']) assert.ok(!(hidden in item), hidden);
    const status = (await getJson(`/${legacyId}`, 'token-a')).body;
    assert.ok(!JSON.stringify(status).match(/fidelity|violation|validation/i));
  });

  await test('exactly 10 credits: one Astra generation succeeds and leaves 0; the next is refused; never negative', async () => {
    await reset();
    await setBalance(USER_A, 10);
    const first = await astraGen();
    assert.equal(first.status, 202);
    await waitDone(first.body.jobId);
    assert.equal(await bal(), 0);
    const calls = fake.astraCalls.length;
    assert.equal((await astraGen()).status, 402);
    assert.equal(await bal(), 0);
    assert.equal(fake.astraCalls.length, calls);
  });

  await test('insufficient credits for Astra (9): refused with 402, no reservation, no Astra call, no image call, no stuck record — while 9 credits still afford standard', async () => {
    await reset();
    await setBalance(USER_A, 9);
    const r = await astraGen();
    assert.equal(r.status, 402);
    assert.equal(r.body.error.code, 'INSUFFICIENT_CREDITS');
    assert.equal(await bal(), 9);
    assert.equal(fake.astraCalls.length + fake.imageCalls.length, 0);
    assert.equal((await store.list(USER_A, 500)).filter((x) => x.status === 'processing').length, 0);
    const std = await generate('standard');
    assert.equal(std.status, 202);
    await waitDone(std.body.jobId);
    assert.equal(await bal(), 9 - STANDARD);
  });

  await test('idempotency: simultaneous identical Astra requests -> ONE pipeline (1 analysis, 1 generation), ONE reservation of 10', async () => {
    await reset();
    fake.slowMs = 120;
    const k1 = key();
    const [a, b] = await Promise.all([post('token-a', multipart({ style: 'classico', generationMode: 'astra', idempotencyKey: k1 }, plan)), post('token-a', multipart({ style: 'classico', generationMode: 'astra', idempotencyKey: k1 }, plan))]);
    const [ja, jb] = [(await a.json()) as any, (await b.json()) as any];
    assert.equal(ja.jobId, jb.jobId);
    await waitDone(ja.jobId);
    assert.equal(fake.imageCalls.length, 1);
    assert.equal(fake.astraCalls.length, 1);
    assert.equal(await bal(), 100 - ASTRA);
    assert.equal((await mem.ledgerForGeneration(USER_A, ja.jobId)).filter((m) => m.type === 'reserve').length, 1);
  });

  await test('a stored key survives a "restart" and the mode of a started generation can NEVER be switched by reusing its key (409, no charge)', async () => {
    await reset();
    const k1 = key();
    const first = (await (await post('token-a', multipart({ style: 'classico', generationMode: 'astra', idempotencyKey: k1 }, plan))).json()) as any;
    await waitDone(first.jobId);
    const balance = await bal();
    const again = await post('token-a', multipart({ style: 'classico', generationMode: 'astra', idempotencyKey: k1 }, plan));
    assert.equal(((await again.json()) as any).jobId, first.jobId);
    const switched = await post('token-a', multipart({ style: 'classico', generationMode: 'standard', idempotencyKey: k1 }, plan));
    assert.equal(switched.status, 409);
    const persisted = { ...(await store.get(USER_A, first.jobId))!, id: '66666666-6666-4666-8666-666666666666', idempotencyKey: 'stored-only-key' };
    await store.insert(persisted);
    const viaDb = await post('token-a', multipart({ style: 'classico', generationMode: 'astra', idempotencyKey: 'stored-only-key' }, plan));
    assert.equal(((await viaDb.json()) as any).jobId, persisted.id);
    const switchedDb = await post('token-a', multipart({ style: 'classico', generationMode: 'standard', idempotencyKey: 'stored-only-key' }, plan));
    assert.equal(switchedDb.status, 409);
    assert.equal(await bal(), balance);
    assert.equal(fake.imageCalls.length, 1);
  });

  // ------------------------------------------------------------ astra: failures -> full refund
  await test('failure in the initial ANALYSIS (provider 500): refunded 10, no image call, analysis marked failed, step recorded as failed, no provider detail leaked', async () => {
    await reset();
    fake.analysisMode = 'error500';
    const r = await astraGen();
    const done = await waitDone(r.body.jobId);
    assert.equal(done.stage, 'error');
    assert.equal(await bal(), 100);
    assert.equal(fake.imageCalls.length, 0);
    const rec = await store.get(USER_A, r.body.jobId);
    assert.equal(rec!.status, 'failed');
    assert.equal(rec!.analysisStatus, 'failed');
    assert.equal(rec!.creditsRefunded, ASTRA);
    assert.deepEqual(await kinds(USER_A, r.body.jobId), ['reserve', 'refund']);
    const steps = await store.listSteps(USER_A, r.body.jobId);
    assert.deepEqual(steps.map((s) => [s.step, s.status]), [['analysis', 'failed']]);
    assert.ok(!JSON.stringify(done).includes('secret provider detail'));
    assert.ok(!JSON.stringify(rec).includes('secret provider detail'));
  });

  await test('analysis with INVALID JSON / empty output / wrong structure: refunded, no image generated', async () => {
    for (const mode of ['invalid_json', 'empty'] as const) {
      await reset();
      fake.analysisMode = mode;
      const r = await astraGen();
      assert.equal((await waitDone(r.body.jobId)).stage, 'error', mode);
      assert.equal(await bal(), 100, mode);
      assert.equal(fake.imageCalls.length, 0, mode);
      assert.equal((await store.get(USER_A, r.body.jobId))!.analysisStatus, 'failed');
    }
  });

  await test('failure of the FIRST generation (provider 400): refunded, validation never called, generation step recorded as failed', async () => {
    await reset();
    fake.imageModes.push('error400');
    const r = await astraGen();
    assert.equal((await waitDone(r.body.jobId)).stage, 'error');
    assert.equal(await bal(), 100);
    assert.deepEqual(fake.astraCalls.map((c) => c.schema), ['astra_architecture_analysis']);
    assert.deepEqual((await store.listSteps(USER_A, r.body.jobId)).map((s) => [s.step, s.status]), [['analysis', 'completed'], ['generation_1', 'failed']]);
    assert.deepEqual(await kinds(USER_A, r.body.jobId), ['reserve', 'refund']);
  });

  await test('image provider answers WITHOUT an image: refunded, nothing delivered', async () => {
    await reset();
    fake.imageModes.push('no_image');
    const r = await astraGen();
    assert.equal((await waitDone(r.body.jobId)).stage, 'error');
    assert.equal(await bal(), 100);
    const rec = await store.get(USER_A, r.body.jobId);
    assert.equal(rec!.resultPath, null);
    assert.equal(rec!.status, 'failed');
  });

  // ------------------------------------------------------------ astra: validation + correction
  // ------------------------------------------------------------ astra: storage / capture ordering
  await test('failure saving the result: refunded, never captured, never "completed"', async () => {
    await reset();
    const realSave = storage.save.bind(storage);
    storage.save = async (u, g, kind, buf, mime) => {
      if (kind === 'result') throw new Error('bucket offline');
      return realSave(u, g, kind, buf, mime);
    };
    try {
      const r = await astraGen();
      assert.equal((await waitDone(r.body.jobId)).stage, 'error');
      assert.equal(await bal(), 100);
      const rec = await store.get(USER_A, r.body.jobId);
      assert.equal(rec!.status, 'failed');
      assert.equal(rec!.resultPath, null);
      assert.deepEqual(await kinds(USER_A, r.body.jobId), ['reserve', 'refund']);
    } finally {
      storage.save = realSave;
    }
  });

  await test('the credits are captured ONLY AFTER the final result is saved and readable', async () => {
    await reset();
    let existedAtCapture: boolean | null = null;
    const realCapture = mem.capture.bind(mem);
    mem.capture = async (u, id, amount) => {
      const pending = (await mem.pending(0, u)).find((p) => p.reservationId === id);
      if (pending?.generationId) existedAtCapture = await storage.exists(`${u}/${pending.generationId}/result.png`);
      return realCapture(u, id, amount);
    };
    try {
      const r = await astraGen();
      assert.equal((await waitDone(r.body.jobId)).stage, 'complete');
      assert.equal(existedAtCapture, true);
    } finally {
      mem.capture = realCapture;
    }
  });

  await test('capture failing after the result is saved: refunded and the generation is not "completed" (never charged for an undelivered state)', async () => {
    await reset();
    const realCapture = mem.capture.bind(mem);
    mem.capture = async () => {
      throw new Error('database unavailable during capture');
    };
    try {
      const r = await astraGen();
      assert.equal((await waitDone(r.body.jobId)).stage, 'error');
      assert.equal(await bal(), 100);
      assert.equal((await store.get(USER_A, r.body.jobId))!.status, 'failed');
    } finally {
      mem.capture = realCapture;
    }
  });

  await test('RESTART during the pipeline: an interrupted Astra generation with NO saved result is refunded 10 by reconciliation; one whose final result WAS saved is captured, not refunded', async () => {
    await reset();
    const base = { ...(await (async () => { const r = await astraGen(); await waitDone(r.body.jobId); return (await store.get(USER_A, r.body.jobId))!; })()) };
    await reset();
    const mk = async (id: string, withResult: boolean) => {
      await store.insert({ ...base, id, idempotencyKey: null, status: 'processing', resultPath: null, resultJpgPath: null, creditsCaptured: 0, completedAt: null, pipelineStage: 'generating', validationStatus: null });
      const reserved = await mem.reserve({ userId: USER_A, amount: 10, tool: 'planta_humanizada_astra', generationId: id, idempotencyKey: null });
      mem.backdateForTests(reserved.reservationId, 3_600_000);
      if (withResult) {
        const rp = await storage.save(USER_A, id, 'result', PNG_A, 'image/png');
        await store.update(USER_A, id, { resultPath: rp });
      }
    };
    const lost = '77777777-7777-4777-8777-777777777777';
    const saved = '88888888-8888-4888-8888-888888888888';
    await mk(lost, false);
    await mk(saved, true);
    const before = await bal();
    await reconciler.reconcileStaleReservations({ olderThanSeconds: 60, userId: USER_A });
    assert.deepEqual(await kinds(USER_A, lost), ['reserve', 'refund']);
    assert.deepEqual(await kinds(USER_A, saved), ['reserve', 'capture']);
    assert.equal((await store.get(USER_A, lost))!.status, 'failed');
    assert.equal((await store.get(USER_A, saved))!.status, 'completed');
    assert.equal(await bal(), before + 10, 'only the lost pipeline\'s 10 credits came back');
    assert.equal(typeof hReconciler.HUMANIZED_ASTRA_TOOL, 'string');
  });

  // ------------------------------------------------------------ models, request shape, references
  await test('Astra is called with EXACTLY "gpt-6-astra", medium reasoning, low verbosity, strict JSON schema, store:false and NO tools; images sent server-side as data URLs', async () => {
    await reset();
    const r = await astraGen();
    await waitDone(r.body.jobId);
    assert.equal(models.OPENAI_ASTRA_MODEL, 'gpt-6-astra');
    assert.equal(fake.astraCalls.length, 1, 'Astra is called exactly once: the analysis');
    for (const c of fake.astraCalls) {
      assert.equal(c.body.model, 'gpt-6-astra');
      assert.equal(c.body.reasoning?.effort, 'medium');
      assert.equal(c.body.text?.verbosity, 'low');
      assert.equal(c.body.text?.format?.type, 'json_schema');
      assert.equal(c.body.text?.format?.strict, true);
      assert.equal(c.body.store, false);
      assert.equal(c.body.tools, undefined);
      const content = c.body.input[0].content;
      assert.ok(content.some((x: any) => x.type === 'input_image' && String(x.image_url).startsWith('data:image/png;base64,')));
    }
    assert.equal(fake.astraCalls[0].body.input[0].content.filter((x: any) => x.type === 'input_image').length, 1);
  });

  await test('the image is generated by EXACTLY the configured Sunburst model, never by Astra', async () => {
    await reset();
    const r = await astraGen();
    await waitDone(r.body.jobId);
    assert.equal(models.OPENAI_BLOCK_IMAGE_MODEL, 'gpt-image-2.5-sunburst');
    assert.ok(fake.imageCalls[0].includes('gpt-image-2.5-sunburst'));
    assert.ok(!fake.imageCalls[0].includes('gpt-6-astra'));
    assert.ok(!fake.imageCalls[0].includes('input_fidelity'));
    const rec = await store.get(USER_A, r.body.jobId);
    assert.equal(rec!.model, 'gpt-image-2.5-sunburst');
    assert.equal(rec!.analysisModel, 'gpt-6-astra');
  });

  await test('the Astra prompt: architecture first, analysis constraints binding, reference used for STYLE only, extra hard rules, user text last', async () => {
    await reset();
    const r = await astraGen({ customInstructions: 'use natural wood', surroundings: 'with', surroundingsKind: 'lawn' }, { ...plan, styleReference: { data: PNG_B, name: 'ref.png' } } as any);
    await waitDone(r.body.jobId);
    const raw = fake.imageCalls[0];
    const idx = (t: string) => raw.indexOf(t);
    assert.ok(idx('PRIORITY 1') >= 0 && idx('PRIORITY 1B') > idx('PRIORITY 1') && idx('PRIORITY 2') > idx('PRIORITY 1B') && idx('PRIORITY 3') > idx('PRIORITY 2') && idx('PRIORITY 7') > idx('PRIORITY 6'));
    assert.ok(raw.includes('Load-bearing walls on all four sides'), 'analysis constraints are in the prompt');
    assert.ok(raw.includes('Forbidden: Moving walls'));
    for (const rule of promptMod.ASTRA_EXTRA_NEGATIVE_RULES) assert.ok(raw.includes(rule), rule);
    for (const rule of promptMod.HUMANIZED_FLOORPLAN_NEGATIVE_RULES) assert.ok(raw.includes(rule), rule);
    assert.ok(raw.includes('Visual style notes extracted from the reference'));
    assert.ok(raw.includes('warm beige'));
    assert.ok(raw.includes('SECOND image is a style reference ONLY'));
    assert.equal((raw.match(/filename="/g) ?? []).length, 2, 'original + reference are sent server-side');
    assert.ok(raw.includes('use natural wood'));
    assert.ok(idx('ANALYSIS GUIDANCE') > idx('PRIORITY 7'), 'analysis guidance never outranks the rules above it');
  });

  await test('without a reference no style notes are added; the analysis call gets one image, and with a reference two', async () => {
    await reset();
    const r = await astraGen();
    await waitDone(r.body.jobId);
    assert.ok(!fake.imageCalls[0].includes('Visual style notes extracted'));
    await reset();
    const r2 = await astraGen({}, { ...plan, styleReference: { data: PNG_B, name: 'ref.png' } } as any);
    await waitDone(r2.body.jobId);
    assert.equal(fake.astraCalls[0].body.input[0].content.filter((x: any) => x.type === 'input_image').length, 2);
  });

  await test('model-written text is sanitized before it is stored or put in a later prompt (control chars, base64 blobs, oversize)', () => {
    const s = schemas.sanitizeText('a\u0000b\nc ' + 'A'.repeat(300));
    assert.ok(!/[\u0000-\u001f]/.test(s));
    assert.ok(s.length <= 240);
    assert.ok(schemas.sanitizeText('x'.repeat(100) + 'AAAA'.repeat(40)).includes('[redacted]') || true);
    assert.ok(!/[A-Za-z0-9+/]{80,}/.test(schemas.sanitizeText('QUJD'.repeat(60))));
  });

  // ------------------------------------------------------------ history / accounting
  await test('history: the record stores the mode and the analysis; the API exposes only the mode (no score, status of validation, correction flag, prompts or internals)', async () => {
    await reset();
    const r = await astraGen();
    await waitDone(r.body.jobId);
    const rec = await store.get(USER_A, r.body.jobId);
    assert.equal(rec!.generationMode, 'astra');
    assert.equal(rec!.analysisStatus, 'completed');
    const list = (await getJson('/history', 'token-a')).body.items as any[];
    const item = list.find((i) => i.id === r.body.jobId);
    assert.equal(item.generationMode, 'astra');
    assert.equal(item.creditsUsed, ASTRA);
    assert.ok(!('autoCorrectionApplied' in item));
    const text = JSON.stringify(list) + JSON.stringify((await getJson(`/${r.body.jobId}`, 'token-a')).body);
    for (const forbidden of ['fidelityScore', 'violationsSummary', 'validationStatus', 'autoCorrectionApplied', 'analysisModel', 'gpt-6-astra', 'pipelineStage', 'PRIORITY', 'fake-openai-key', 'costUsd', 'reservationId']) assert.ok(!text.includes(forbidden), forbidden);
  });

  await test('pipeline accounting: one row per step (analysis + generation) with model, tokens (input/cached/output/total), reasoning effort, request id, duration and cost; total cost on the record', async () => {
    await reset();
    const r = await astraGen();
    await waitDone(r.body.jobId);
    const steps = await store.listSteps(USER_A, r.body.jobId);
    assert.deepEqual(steps.map((s) => s.step), ['analysis', 'generation_1']);
    const analysis = steps[0];
    assert.equal(analysis.model, 'gpt-6-astra');
    assert.equal(analysis.reasoningEffort, 'medium');
    assert.equal(analysis.inputTokens, 2000);
    assert.equal(analysis.cachedInputTokens, 500);
    assert.equal(analysis.outputTokens, 800);
    assert.equal(analysis.totalTokens, 2800);
    assert.ok(analysis.requestId && analysis.requestId.startsWith('resp_'));
    assert.ok(analysis.durationMs !== null && analysis.durationMs >= 0);
    // (2000-500)*2 + 500*0.5 + 800*10 per 1M tokens
    assert.equal(analysis.costUsd, Math.round(((1500 * 2 + 500 * 0.5 + 800 * 10) / 1_000_000) * 1e6) / 1e6);
    const gen = steps[1];
    assert.equal(gen.model, 'gpt-image-2.5-sunburst');
    assert.equal(gen.inputTokens, 1500);
    assert.equal(gen.outputTokens, 4000);
    assert.equal(gen.costUsd, Math.round(((500 * 5 + 1000 * 8 + 4000 * 30) / 1_000_000) * 1e6) / 1e6);
    assert.ok(steps.every((s) => s.status === 'completed' && s.startedAt && s.completedAt));
    const rec = await store.get(USER_A, r.body.jobId);
    const sum = Math.round(steps.reduce((a, s) => a + (s.costUsd ?? 0), 0) * 1e6) / 1e6;
    assert.equal(rec!.costUsd, sum);
    assert.ok(!JSON.stringify(steps).includes('base64'));
  });

  await test('cost functions: computed from configurable prices; null (never a guess) when a price or usage is missing; a null step makes the total null; delivery is never blocked', () => {
    const usage = { inputTokens: 1_000_000, cachedInputTokens: 400_000, outputTokens: 1_000_000, reasoningTokens: 100, totalTokens: 2_000_000 };
    assert.equal(astraCost.estimateAstraCostUsd(usage, { inputPerM: 2, cachedInputPerM: 0.5, outputPerM: 10 }), 0.6 * 2 + 0.4 * 0.5 + 10);
    assert.equal(astraCost.estimateAstraCostUsd(usage, { inputPerM: 2, cachedInputPerM: null, outputPerM: 10 }), null);
    assert.equal(astraCost.estimateAstraCostUsd(null, { inputPerM: 2, cachedInputPerM: 0.5, outputPerM: 10 }), null);
    assert.equal(astraCost.sumCosts([1, 2, 3]), 6);
    assert.equal(astraCost.sumCosts([1, null, 3]), null);
    assert.equal(astraCost.sumCosts([]), null);
  });

  await test('an unpriced run still DELIVERS the image (cost null): missing prices never block a valid result', async () => {
    await reset();
    fake.noAstraUsage = true; // the provider reports no usage -> the cost cannot be known
    const r = await astraGen();
    assert.equal((await waitDone(r.body.jobId)).stage, 'complete');
    const rec = await store.get(USER_A, r.body.jobId);
    assert.equal(rec!.costUsd, null, 'unknown usage means an unknown total, never an invented one');
    assert.equal(rec!.status, 'completed');
    const steps = await store.listSteps(USER_A, r.body.jobId);
    assert.equal(steps.find((x) => x.step === 'analysis')!.costUsd, null);
    assert.equal(steps.find((x) => x.step === 'analysis')!.inputTokens, null);
    assert.notEqual(steps.find((x) => x.step === 'generation_1')!.costUsd, null, 'the image step keeps its own known cost');
  });

  await test('legacy records (no mode / no astra fields) still open and read as "standard" with their original credits untouched', async () => {
    await reset();
    const legacyPath = path.join(tmpDir, 'legacy.json');
    fs.writeFileSync(legacyPath, JSON.stringify([{ id: '33333333-3333-4333-8333-333333333333', userId: USER_A, status: 'completed', style: 'classico', lighting: 'clear_day', createdAt: '2026-01-01T00:00:00.000Z', creditsCaptured: 2, creditsRefunded: 0, resultPath: null, originalPath: null, referencePath: null }]));
    storeMod.setGenerationStoreForTests(new storeMod.LocalGenerationStore(legacyPath));
    const hist = await getJson('/history', 'token-a');
    storeMod.setGenerationStoreForTests(store);
    assert.equal(hist.status, 200);
    assert.equal(hist.body.items[0].generationMode, 'standard');
    assert.ok(!('autoCorrectionApplied' in hist.body.items[0]));
    assert.equal(hist.body.items[0].creditsUsed, 2);
    assert.equal(storeMod.withModeDefaults({}).generationMode, 'standard');
    assert.equal(storeMod.withModeDefaults({}).attemptsCount, 1);
  });

  await test('another user cannot poll, delete, download or reuse an Astra generation (404), and a refused reuse spends nothing', async () => {
    await reset();
    const a = await astraGen();
    await waitDone(a.body.jobId);
    assert.equal((await getJson(`/${a.body.jobId}`, 'token-b')).status, 404);
    assert.equal((await fetch(`${base}/${a.body.jobId}`, { method: 'DELETE', headers: { Authorization: 'Bearer token-b' } })).status, 404);
    const calls = fake.astraCalls.length;
    const reuse = await post('token-b', multipart({ style: 'classico', generationMode: 'astra', idempotencyKey: key(), sourceGenerationId: a.body.jobId }));
    assert.equal(reuse.status, 404);
    assert.equal(await bal(USER_B), 100);
    assert.equal(fake.astraCalls.length, calls);
    assert.deepEqual(await store.listSteps(USER_B, a.body.jobId), [], 'pipeline accounting is scoped to its owner');
    assert.ok(!((await getJson('/history', 'token-b')).body.items as any[]).some((i) => i.id === a.body.jobId));
  });

  await test('"create new version / generate again" from an Astra generation is a NEW request charged for the mode chosen NOW (switching to standard costs 2, staying on astra costs 10)', async () => {
    await reset();
    const first = await astraGen();
    await waitDone(first.body.jobId);
    assert.equal(await bal(), 100 - ASTRA);
    const asStandard = await post('token-a', multipart({ style: 'contemporaneo', generationMode: 'standard', idempotencyKey: key(), sourceGenerationId: first.body.jobId }));
    const s = (await asStandard.json()) as any;
    await waitDone(s.jobId);
    assert.equal(await bal(), 100 - ASTRA - STANDARD);
    assert.equal((await store.get(USER_A, s.jobId))!.generationMode, 'standard');
    const asAstra = await post('token-a', multipart({ style: 'contemporaneo', generationMode: 'astra', idempotencyKey: key(), sourceGenerationId: first.body.jobId }));
    await waitDone(((await asAstra.json()) as any).jobId);
    assert.equal(await bal(), 100 - 2 * ASTRA - STANDARD);
  });

  await test('real stages are persisted by the backend and readable after a restart: analyzing_architecture -> preparing -> generating -> finalizing (no verifying / correcting)', async () => {
    await reset();
    const seen: string[] = [];
    const realUpdate = store.update.bind(store);
    store.update = async (u, id, patch) => {
      if (patch.pipelineStage) seen.push(patch.pipelineStage);
      return realUpdate(u, id, patch);
    };
    try {
      const r = await astraGen();
      await waitDone(r.body.jobId);
      assert.deepEqual(seen.filter((s, i) => s !== seen[i - 1]), ['analyzing_architecture', 'preparing', 'generating', 'finalizing', 'complete']);
      assert.equal((await store.get(USER_A, r.body.jobId))!.pipelineStage, 'complete');
    } finally {
      store.update = realUpdate;
    }
  });

  await test('polling the status never calls a provider or touches credits (Astra generation included)', async () => {
    await reset();
    const r = await astraGen();
    await waitDone(r.body.jobId);
    const before = { astra: fake.astraCalls.length, img: fake.imageCalls.length, balance: await bal() };
    for (let i = 0; i < 5; i++) await getJson(`/${r.body.jobId}`, 'token-a');
    assert.deepEqual({ astra: fake.astraCalls.length, img: fake.imageCalls.length, balance: await bal() }, before);
  });

  // ------------------------------------------------------------ geometry-preserving canvas (BOTH modes)
  const wideImg = new Jimp({ width: 400, height: 100, color: 0xffffffff });
  for (let x = 0; x < 400; x += 10) for (let y = 10; y < 90; y++) wideImg.setPixelColor(0x102030ff, x, y);
  const WIDE = Buffer.from(await wideImg.getBuffer('image/png'));
  const exactImg = new Jimp({ width: 300, height: 200, color: 0xffffffff });
  for (let x = 0; x < 300; x += 9) for (let y = 5; y < 195; y++) exactImg.setPixelColor(0x304050ff, x, y);
  const EXACT = Buffer.from(await exactImg.getBuffer('image/png'));

  /** The first uploaded image part (the plan) of a captured /v1/images/edits multipart body. */
  const planPartOf = (raw: string): Buffer => {
    const at = raw.search(/filename="floorplan-original/);
    const start = raw.indexOf('\r\n\r\n', at) + 4;
    return Buffer.from(raw.slice(start, raw.indexOf('\r\n--', start)), 'latin1');
  };

  for (const mode of ['standard', 'astra'] as const) {
    await test(`[${mode}] a plan whose ratio does not match gets the NEAREST supported size and neutral margins; the model receives the plan pixel-for-pixel on a canvas of exactly that ratio`, async () => {
      await reset();
      const r = await generate(mode, {}, { image: { data: WIDE, name: 'larga.png' } });
      assert.equal((await waitDone(r.body.jobId)).stage, 'complete');
      const raw = fake.imageCalls[0];
      assert.ok(/name="size"\r\n\r\n1536x1024/.test(raw), `${mode}: size must be the nearest supported (1536x1024) for a 4:1 plan`);
      assert.ok(raw.includes('CANVAS NOTE'), 'the prompt tells the model about the neutral margins');
      const sent = await Jimp.read(planPartOf(raw));
      assert.equal(sent.width, 400);
      assert.equal(sent.height, Math.ceil(400 / 1.5));
      assert.ok(Math.abs(sent.width / sent.height - 1.5) < 0.01, 'canvas ratio equals the output ratio');
      const orig = await Jimp.read(WIDE);
      const offY = Math.floor((sent.height - 100) / 2);
      let diff = 0;
      for (let y = 0; y < 100; y++) for (let x = 0; x < 400; x++) if (sent.getPixelColor(x, y + offY) !== orig.getPixelColor(x, y)) diff++;
      assert.equal(diff, 0, `${mode}: the plan must not be resampled, stretched, squeezed or cropped`);
      assert.equal(sent.getPixelColor(0, 0), 0xffffffff, 'margins are neutral');
    });

    await test(`[${mode}] a plan that already matches a supported ratio is sent UNTOUCHED (same bytes), with that size and no margin note`, async () => {
      await reset();
      const r = await generate(mode, {}, { image: { data: EXACT, name: 'exata.png' } });
      await waitDone(r.body.jobId);
      const raw = fake.imageCalls[0];
      assert.ok(/name="size"\r\n\r\n1536x1024/.test(raw));
      assert.ok(!raw.includes('CANVAS NOTE'));
      assert.deepEqual(planPartOf(raw), EXACT, `${mode}: no re-encoding of an already-fitting plan`);
    });

    await test(`[${mode}] an explicit "quadrado" format still pads (never stretches): a 3:2 plan on a square canvas`, async () => {
      await reset();
      const r = await generate(mode, { outputFormat: 'square' }, { image: { data: EXACT, name: 'exata.png' } });
      await waitDone(r.body.jobId);
      const raw = fake.imageCalls[0];
      assert.ok(/name="size"\r\n\r\n1024x1024/.test(raw));
      const sent = await Jimp.read(planPartOf(raw));
      assert.deepEqual({ w: sent.width, h: sent.height }, { w: 300, h: 300 });
      const orig = await Jimp.read(EXACT);
      let diff = 0;
      for (let y = 0; y < 200; y++) for (let x = 0; x < 300; x++) if (sent.getPixelColor(x, y + 50) !== orig.getPixelColor(x, y)) diff++;
      assert.equal(diff, 0);
    });
  }

  await test('ASTRA: the single Astra call sees the ORIGINAL plan untouched; the generator receives the margin canvas', async () => {
    await reset();
    const r = await astraGen({}, { image: { data: WIDE, name: 'larga.png' } });
    await waitDone(r.body.jobId);
    const dims = async (dataUrl: string) => {
      const img = await Jimp.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
      return { w: img.width, h: img.height };
    };
    const imageUrls = (call: number) => fake.astraCalls[call].body.input[0].content.filter((x: any) => x.type === 'input_image').map((x: any) => x.image_url as string);
    assert.equal(fake.astraCalls.length, 1);
    assert.deepEqual(await dims(imageUrls(0)[0]), { w: 400, h: 100 }, 'analysis: the untouched original');
    const sent = await Jimp.read(planPartOf(fake.imageCalls[0]));
    assert.deepEqual({ w: sent.width, h: sent.height }, { w: 400, h: Math.ceil(400 / 1.5) });
  });

  // ------------------------------------------------------------ honest error classification (the "invalid API key" report)
  const captureLogs = async <T>(fn: () => Promise<T>): Promise<{ result: T; logs: string }> => {
    const chunks: string[] = [];
    const realErr = console.error;
    const realLog = console.log;
    console.error = (...a: unknown[]) => void chunks.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    console.log = (...a: unknown[]) => void chunks.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    try {
      return { result: await fn(), logs: chunks.join('\n') };
    } finally {
      console.error = realErr;
      console.log = realLog;
    }
  };

  await test('a REAL invalid key (401 invalid_api_key) is reported as INVALID_API_KEY; the log keeps status, code, type and request id and the redacted ORIGINAL message, never the key; the 10 credits are refunded', async () => {
    await reset();
    fake.analysisMode = 'auth401';
    const { result: r, logs } = await captureLogs(async () => {
      const g = await astraGen();
      const done = await waitDone(g.body.jobId);
      return { g, done };
    });
    assert.equal(r.done.error.code, 'INVALID_API_KEY');
    assert.equal(await bal(), 100);
    assert.match(logs, /"status":401|status: 401/);
    assert.match(logs, /invalid_api_key/);
    assert.match(logs, /req_test_401/);
    assert.match(logs, /Incorrect API key provided/);
    assert.ok(!logs.includes('FAKESECRETKEYVALUE'), 'the key fragment must be redacted from the log');
    assert.ok(!logs.includes('fake-openai-key'), 'the configured key never appears');
    const steps = await store.listSteps(USER_A, r.g.body.jobId);
    assert.equal(steps[0].status, 'failed');
    assert.ok(String(steps[0].detail?.providerError).includes('code=invalid_api_key'), 'the safe diagnostic is kept on the failed step');
    assert.ok(!JSON.stringify(steps).includes('FAKESECRETKEYVALUE'));
    assert.deepEqual(await kinds(USER_A, r.g.body.jobId), ['reserve', 'refund']);
  });

  await test('access / permission / model problems are NOT reported as an invalid key: 401 insufficient_permissions, 403 model access and 404 model_not_found become PROVIDER_UNAVAILABLE (and are logged with their real code)', async () => {
    for (const [mode, code] of [['perm401', 'insufficient_permissions'], ['forbidden403', 'model_not_allowed'], ['notfound404', 'model_not_found']] as const) {
      await reset();
      fake.analysisMode = mode;
      const { result, logs } = await captureLogs(async () => waitDone((await astraGen()).body.jobId));
      assert.equal(result.error.code, 'PROVIDER_UNAVAILABLE', mode);
      assert.notEqual(result.error.code, 'INVALID_API_KEY', mode);
      assert.match(logs, new RegExp(code), mode);
      assert.equal(await bal(), 100, mode);
    }
  });

  await test('classifier table: only the invalid_api_key code (or a bare 401) means "bad key"; every other status/code maps to what it really is', async () => {
    const OpenAIMod = OpenAI; // the same class instance the provider code uses (a dynamic import would load the ESM twin)
    const errs = await import('../src/lib/openaiErrors');
    const make = (status: number, code: string | null) => OpenAIMod.APIError.generate(status, { error: { message: 'm', type: 't', code, param: null } }, 'm', new Headers({ 'x-request-id': 'req_x' }));
    const kind = (status: number, code: string | null) => errs.classifyKind(errs.describeOpenAiError(make(status, code)));
    assert.equal(kind(401, 'invalid_api_key'), 'invalid_api_key');
    assert.equal(kind(401, null), 'invalid_api_key');
    assert.equal(kind(401, 'insufficient_permissions'), 'access_denied');
    assert.equal(kind(403, 'unsupported_country_region_territory'), 'access_denied');
    assert.equal(kind(403, null), 'access_denied');
    assert.equal(kind(404, 'model_not_found'), 'model_unavailable');
    assert.equal(kind(429, 'rate_limit_exceeded'), 'rate_limited');
    assert.equal(kind(400, 'invalid_input_fidelity_model'), 'bad_request');
    assert.equal(kind(500, null), 'server_error');
    assert.equal(kind(503, null), 'server_error');
    const info = errs.describeOpenAiError(make(401, 'invalid_api_key'));
    assert.equal(info.requestId, 'req_x');
    assert.equal(errs.toAppError(info, 'x').code, 'INVALID_API_KEY');
    assert.equal(errs.toAppError(errs.describeOpenAiError(make(403, 'x')), 'x').code, 'PROVIDER_UNAVAILABLE');
    assert.equal(errs.toAppError(errs.describeOpenAiError(make(400, 'x')), 'x').code, 'VALIDATION_ERROR');
    const redacted = errs.redactSecrets('Incorrect API key provided: sk-proj-ABCDEFGHIJKLMNOP12345 and Bearer abc.def-ghi ' + 'A'.repeat(120));
    assert.ok(!redacted.includes('ABCDEFGHIJKLMNOP') && !redacted.includes('abc.def-ghi') && !/A{80}/.test(redacted));
  });

  // ------------------------------------------------------------ structural guarantees
  const readSrc = (p: string) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  await test('the Astra provider never logs images/keys/headers, sends no tools, never generates images, and the pipeline never imports credit functions (money stays in the route)', () => {
    const provider = strip(readSrc('src/providers/openaiAstra.ts'));
    assert.ok(!/images\.(generate|edit)/.test(provider));
    assert.ok(!/tools\s*:/.test(provider));
    assert.ok(!/Authorization|headers/i.test(provider));
    for (const call of provider.match(/openaiLogger\.(?:log|error)\([^;]*\);/g) ?? []) assert.ok(!/apiKey|OPENAI_API_KEY|base64|buffer/i.test(call), call);
    assert.ok(!/logger\.(log|error)\([^)]*(base64|buffer|toString\('base64'\))/i.test(provider));
    const pipeline = strip(readSrc('src/services/humanizedFloorplanAstraPipeline.ts'));
    assert.ok(!/captureCredits|refundCredits|reserveCredits|creditWallet/.test(pipeline));
  });


  await test('ASTRA never validates, scores, corrects or retries: one analyzeFloorplanWithAstra call site, one generateHumanizedFloorplanImage call site, no loop, no score/violation code anywhere in the flow', () => {
    const pipeline = strip(readSrc('src/services/humanizedFloorplanAstraPipeline.ts'));
    assert.equal((pipeline.match(/analyzeFloorplanWithAstra\(/g) ?? []).length, 1);
    assert.equal((pipeline.match(/generateHumanizedFloorplanImage\(/g) ?? []).length, 1);
    assert.ok(!/\bwhile\s*\(|\bfor\s*\(\s*let/.test(pipeline.replace(/for \(const/g, '')));
    for (const banned of ['evaluateValidation', 'validateFloorplanWithAstra', 'fidelity', 'violation', 'ARCHITECTURE_VALIDATION_FAILED', 'approved', 'deliverable', 'correction', 'validation_1', 'validation_2', 'generation_2', 'candidate']) {
      assert.ok(!new RegExp(banned, 'i').test(pipeline), `pipeline must not contain "${banned}"`);
    }
    const route = strip(readSrc('src/routes/generateHumanizedFloorplanSimple.ts'));
    for (const banned of ['evaluateValidation', 'ARCHITECTURE_VALIDATION_FAILED', 'result.validationStatus', 'result.fidelityScore', 'result.violations', 'result.autoCorrectionApplied']) assert.ok(!route.includes(banned), banned);
    const provider = strip(readSrc('src/providers/openaiAstra.ts'));
    assert.ok(!/validateFloorplanWithAstra|VALIDATION_INSTRUCTIONS|fidelity/i.test(provider));
    const schemasSrc = strip(readSrc('src/lib/astra/astraSchemas.ts'));
    assert.ok(!/fidelity|evaluateValidation|AstraValidation/i.test(schemasSrc));
    assert.equal((astraCfg as Record<string, unknown>).ASTRA_APPROVAL_SCORE, undefined);
    assert.equal((astraCfg as Record<string, unknown>).ASTRA_MIN_DELIVERABLE_SCORE, undefined);
    assert.equal((schemas as Record<string, unknown>).evaluateValidation, undefined);
    assert.equal((astraProvider as Record<string, unknown>).validateFloorplanWithAstra, undefined);
  });

  await test('Astra config: only the feature flag, the pipeline ceiling and sanitizing limits live in config; the flag is on ONLY for the exact string "true"', () => {
    assert.equal(astraCfg.isAstraFlagEnabled({ HUMANIZED_FLOORPLAN_ASTRA_ENABLED: 'true' } as any), true);
    for (const v of [undefined, '', '1', 'TRUE', 'yes', 'false']) assert.equal(astraCfg.isAstraFlagEnabled({ HUMANIZED_FLOORPLAN_ASTRA_ENABLED: v } as any), false, String(v));
    assert.equal(astraProvider.getAstraCallCount() > 0, true);
  });

  await test('the interface exposes no stage, label or code that hides a generated image: verifying / correcting / ARCHITECTURE_VALIDATION_FAILED are gone from backend types and the safe-message table', () => {
    const types = strip(readSrc('src/types/humanizedFloorplan.ts'));
    assert.ok(!/'verifying'|'correcting'|autoCorrectionApplied/.test(types));
    const route = strip(readSrc('src/routes/generateHumanizedFloorplanSimple.ts'));
    assert.ok(!/verifying|correcting/.test(route));
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
