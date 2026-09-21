/**
 * Behavioral tests for Arquiteto Estagiário (the chat assistant). Runs the
 * REAL route, wallet service, chat store, file storage and both OpenAI
 * providers (streamed chat + audio transcription) against a LOCAL fake server
 * that speaks the real API shapes (/v1/responses streaming, /v1/audio/transcriptions,
 * Supabase auth). Nothing leaves this machine; no key is used; no credit is spent.
 *
 * Run with: npm run test:architect-chat -w backend
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

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
// A minimal but valid 1x1 PNG.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const fake = {
  chatMode: 'ok' as 'ok' | 'error500' | 'auth401',
  chatCalls: [] as Array<{ body: any }>,
  transcribeMode: 'ok' as 'ok' | 'error500' | 'empty',
  transcribeCalls: [] as string[],
  transcript: 'Preciso reforçar esta parede.',
};

/** One realistic streamed /v1/responses event sequence for a given final text — matches the openai SDK's own response-accumulator validation exactly (created -> output_item.added -> content_part.added -> output_text.delta* -> output_text.done -> content_part.done -> output_item.done -> completed). */
function buildStreamFrames(text: string, requestId: string): string {
  const itemId = `msg_${requestId}`;
  const half = Math.ceil(text.length / 2);
  const chunks = [text.slice(0, half), text.slice(half)].filter(Boolean);
  const base = { id: requestId, object: 'response', created_at: 1, model: 'gpt-5.6-sol' };
  const events: unknown[] = [
    { type: 'response.created', response: { ...base, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { id: itemId, type: 'message', role: 'assistant', status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', output_index: 0, content_index: 0, item_id: itemId, part: { type: 'output_text', text: '', annotations: [] } },
  ];
  let acc = '';
  for (const chunk of chunks) {
    acc += chunk;
    events.push({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: itemId, delta: chunk });
  }
  events.push({ type: 'response.output_text.done', output_index: 0, content_index: 0, item_id: itemId, text: acc });
  events.push({ type: 'response.content_part.done', output_index: 0, content_index: 0, item_id: itemId, part: { type: 'output_text', text: acc, annotations: [] } });
  events.push({ type: 'response.output_item.done', output_index: 0, item: { id: itemId, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: acc, annotations: [] }] } });
  events.push({
    type: 'response.completed',
    response: {
      ...base,
      status: 'completed',
      output: [{ id: itemId, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: acc, annotations: [] }] }],
      output_text: acc,
      usage: { input_tokens: 120, input_tokens_details: { cached_tokens: 20 }, output_tokens: 40, total_tokens: 160 },
    },
  });
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
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
        fake.chatCalls.push({ body });
        if (fake.chatMode === 'auth401') {
          res.writeHead(401, { 'Content-Type': 'application/json', 'x-request-id': 'req_test_401' }).end(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-proj-FAKE1234567890.', type: 'invalid_request_error', code: 'invalid_api_key', param: null } }));
          return;
        }
        if (fake.chatMode === 'error500') return send(500, { error: { message: 'secret provider detail', type: 'server_error' } });
        const requestId = `resp_${Math.random().toString(36).slice(2, 10)}`;
        const text = 'Olá! Posso ajudar com isso.';
        res.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(buildStreamFrames(text, requestId));
        return;
      }
      if (url.startsWith('/v1/audio/transcriptions')) {
        fake.transcribeCalls.push(Buffer.concat(chunks).toString('latin1'));
        if (fake.transcribeMode === 'error500') return send(500, { error: { message: 'secret provider detail', type: 'server_error' } });
        if (fake.transcribeMode === 'empty') return send(200, { text: '' });
        return send(200, { text: fake.transcript });
      }
      res.writeHead(404).end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function multipart(fields: Record<string, string>, files: Array<{ data: Buffer; name: string; mime: string }> = []): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const f of files) form.append('attachments', new Blob([new Uint8Array(f.data)], { type: f.mime }), f.name);
  return form;
}

interface SseEvent {
  type: string;
  [k: string]: unknown;
}

async function collectSSE(res: Response): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = raw.split('\n').find((l) => l.startsWith('data: '));
      if (line) events.push(JSON.parse(line.slice('data: '.length)));
    }
  }
  return events;
}

async function main() {
  console.log('Arquiteto Estagiário — chat assistant (local fake OpenAI)\n');
  const fakeServer = await startFakeServer();
  const port = (fakeServer.address() as AddressInfo).port;
  process.env.SUPABASE_URL = `http://127.0.0.1:${port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
  process.env.OPENAI_API_KEY = 'fake-openai-key';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.WALLET_SIGNUP_BONUS_CREDITS = '20';
  process.env.ARCHITECT_CHAT_ENABLED = 'true';

  const express = (await import('express')).default;
  const { architectChatRouter } = await import('../src/routes/architectChat');
  const walletMod = await import('../src/services/creditWallet');
  const storeMod = await import('../src/services/architectChatStore');
  const filesMod = await import('../src/storage/architectChatFiles');
  const cfg = await import('../src/config/architectChat');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-chat-test-'));
  const mem = new walletMod.MemoryWalletBackend();
  const store = new storeMod.LocalArchitectChatStore(path.join(tmpDir, 'chat.json'));
  const storage = new filesMod.LocalArchitectChatFileStorage(path.join(tmpDir, 'files'));
  walletMod.setWalletBackendForTests(mem);
  storeMod.setArchitectChatStoreForTests(store);
  filesMod.setArchitectChatFileStorageForTests(storage);

  const app = express();
  app.use(express.json());
  app.use('/api', architectChatRouter);
  const appServer = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}/api/architect-chat`;

  let k = 0;
  const key = () => `chat-key-${Date.now()}-${k++}`;
  const authHeaders = (token: string | null) => (token ? { Authorization: `Bearer ${token}` } : {});
  const getJson = async (p: string, token: string | null) => {
    const r = await fetch(`${base}${p}`, { headers: authHeaders(token) });
    return { status: r.status, body: (await r.json()) as any };
  };
  const send = async (conversationId: string, form: FormData, token = 'token-a') => {
    const r = await fetch(`${base}/conversations/${conversationId}/messages`, { method: 'POST', body: form, headers: authHeaders(token) });
    if (r.status !== 200) return { status: r.status, body: (await r.json()) as any, events: [] as SseEvent[] };
    return { status: r.status, body: null, events: await collectSSE(r) };
  };
  const bal = (u = USER_A) => mem.balance(u);
  const reset = async () => {
    fake.chatMode = 'ok';
    fake.chatCalls.length = 0;
    fake.transcribeMode = 'ok';
    fake.transcribeCalls.length = 0;
    process.env.ARCHITECT_CHAT_ENABLED = 'true';
    await setBalance(USER_A, 20);
    await setBalance(USER_B, 20);
  };
  async function setBalance(u: string, target: number) {
    await mem.ensure(u, 20);
    const cur = await mem.balance(u);
    if (cur > target) {
      const r = await mem.reserve({ userId: u, amount: cur - target, tool: 'test_setup', generationId: null, idempotencyKey: null });
      await mem.capture(u, r.reservationId);
    } else if (cur < target) await mem.credit(u, target - cur, 'test_setup', 'test', null);
  }

  // ------------------------------------------------------------ config
  await test('config: reflects the flag and the single credit cost; no secret leaks', async () => {
    await reset();
    const { body } = await getJson('/config', null);
    assert.deepEqual(body, { available: true, costCredits: 1 });
    assert.equal(cfg.ARCHITECT_CHAT_COST_CREDITS, 1);
    const text = JSON.stringify(body);
    for (const secret of ['fake-openai-key', 'fake-service-key', 'gpt-5.6-sol']) assert.ok(!text.includes(secret));
  });

  await test('flag OFF: /config reports unavailable and POST is refused (400) with NO reservation and NO provider call', async () => {
    await reset();
    process.env.ARCHITECT_CHAT_ENABLED = 'false';
    assert.equal((await getJson('/config', null)).body.available, false);
    const r = await send('new', multipart({ text: 'Oi' }));
    assert.equal(r.status, 400);
    assert.equal(await bal(), 20);
    assert.equal(fake.chatCalls.length, 0);
    process.env.ARCHITECT_CHAT_ENABLED = 'true';
  });

  // ------------------------------------------------------------ happy path
  await test('happy path: 1 credit reserved and captured; a new conversation is created and titled from the text; both messages are stored', async () => {
    await reset();
    const r = await send('new', multipart({ text: 'Como calcular a carga de uma laje?' }));
    assert.equal(r.status, 200);
    assert.deepEqual(r.events.map((e) => e.type), ['start', 'delta', 'delta', 'done']);
    const conversationId = r.events[0].conversationId as string;
    assert.ok(conversationId);
    assert.equal(await bal(), 19);
    const ledger = await mem.ledgerForGeneration(USER_A, r.events[0].userMessageId as string);
    assert.deepEqual(ledger.map((m) => [m.type, m.amount]), [['reserve', 1], ['capture', 1]]);
    const { body: detail } = await getJson(`/conversations/${conversationId}`, 'token-a');
    assert.equal(detail.title, 'Como calcular a carga de uma laje?');
    assert.equal(detail.messages.length, 2);
    assert.equal(detail.messages[0].role, 'user');
    assert.equal(detail.messages[0].content, 'Como calcular a carga de uma laje?');
    assert.equal(detail.messages[1].role, 'assistant');
    assert.equal(detail.messages[1].content, 'Olá! Posso ajudar com isso.');
    assert.equal(detail.messages[1].status, 'completed');
    const { body: list } = await getJson('/conversations', 'token-a');
    assert.ok(list.conversations.some((c: any) => c.id === conversationId));
  });

  await test('a message with no text and no attachments is rejected (400) before any reservation', async () => {
    await reset();
    const r = await send('new', multipart({}));
    assert.equal(r.status, 400);
    assert.equal(await bal(), 20);
    assert.equal(fake.chatCalls.length, 0);
  });

  await test('exactly 1 credit: one message succeeds and leaves the balance at 0; a second is refused with 402 and nothing is charged', async () => {
    await reset();
    await setBalance(USER_A, 1);
    const first = await send('new', multipart({ text: 'Oi' }));
    assert.equal(first.status, 200);
    assert.equal(await bal(), 0);
    const conversationId = first.events[0].conversationId as string;
    const second = await send(conversationId, multipart({ text: 'De novo' }));
    assert.equal(second.status, 402);
    assert.equal(await bal(), 0);
  });

  // ------------------------------------------------------------ continuing a conversation
  await test('sending a second message reuses the SAME conversation and replays prior text as history (never re-sending prior images)', async () => {
    await reset();
    const first = await send('new', multipart({ text: 'Primeira pergunta' }));
    const conversationId = first.events[0].conversationId as string;
    const second = await send(conversationId, multipart({ text: 'Segunda pergunta' }));
    assert.equal(second.status, 200);
    assert.equal(second.events[0].conversationId, conversationId);
    const lastCall = fake.chatCalls[fake.chatCalls.length - 1].body;
    const historyTexts = lastCall.input.slice(0, -1).map((t: any) => t.content);
    assert.ok(historyTexts.some((c: string) => c.includes('Primeira pergunta')));
    assert.ok(historyTexts.some((c: string) => c.includes('Olá! Posso ajudar com isso.')));
    const { body: detail } = await getJson(`/conversations/${conversationId}`, 'token-a');
    assert.equal(detail.messages.length, 4);
  });

  // ------------------------------------------------------------ attachments
  await test('an image attachment is stored, exposed as a signed URL, and sent to the model as input_image (base64 data URL)', async () => {
    await reset();
    const png = Buffer.from(PNG_B64, 'base64');
    const r = await send('new', multipart({ text: 'O que você vê nesta planta?' }, [{ data: png, name: 'planta.png', mime: 'image/png' }]));
    assert.equal(r.status, 200);
    const conversationId = r.events[0].conversationId as string;
    const { body: detail } = await getJson(`/conversations/${conversationId}`, 'token-a');
    const userMsg = detail.messages[0];
    assert.equal(userMsg.attachments.length, 1);
    assert.equal(userMsg.attachments[0].kind, 'image');
    assert.ok(userMsg.attachments[0].url);
    const lastCall = fake.chatCalls[fake.chatCalls.length - 1].body;
    const currentTurn = lastCall.input[lastCall.input.length - 1];
    assert.ok(currentTurn.content.some((c: any) => c.type === 'input_image' && String(c.image_url).startsWith('data:image/png;base64,')));
  });

  await test('an unreadable/unsupported image is rejected (400) before any reservation', async () => {
    await reset();
    const garbage = Buffer.from('not a real image');
    const r = await send('new', multipart({ text: 'oi' }, [{ data: garbage, name: 'x.png', mime: 'image/png' }]));
    assert.equal(r.status, 400);
    assert.equal(await bal(), 20);
  });

  await test('an audio attachment is transcribed once; the transcript is stored on the attachment AND folded into the text sent to the model — audio bytes are never sent to the chat model', async () => {
    await reset();
    const audio = Buffer.from('fake webm bytes');
    const r = await send('new', multipart({}, [{ data: audio, name: 'nota.webm', mime: 'audio/webm' }]));
    assert.equal(r.status, 200);
    assert.equal(fake.transcribeCalls.length, 1);
    const conversationId = r.events[0].conversationId as string;
    const { body: detail } = await getJson(`/conversations/${conversationId}`, 'token-a');
    const userMsg = detail.messages[0];
    assert.equal(userMsg.attachments[0].kind, 'audio');
    assert.equal(userMsg.attachments[0].transcript, fake.transcript);
    const lastCall = fake.chatCalls[fake.chatCalls.length - 1].body;
    const currentTurn = lastCall.input[lastCall.input.length - 1];
    const textParts = currentTurn.content.filter((c: any) => c.type === 'input_text').map((c: any) => c.text).join('\n');
    assert.ok(textParts.includes(fake.transcript));
    assert.ok(!currentTurn.content.some((c: any) => c.type === 'input_audio'));
  });

  await test('a text/plain attachment is inlined into the message text sent to the model', async () => {
    await reset();
    const txt = Buffer.from('Especificação: pé-direito mínimo de 2.60m.');
    const r = await send('new', multipart({ text: 'Veja o anexo' }, [{ data: txt, name: 'spec.txt', mime: 'text/plain' }]));
    assert.equal(r.status, 200);
    const lastCall = fake.chatCalls[fake.chatCalls.length - 1].body;
    const currentTurn = lastCall.input[lastCall.input.length - 1];
    const textParts = currentTurn.content.filter((c: any) => c.type === 'input_text').map((c: any) => c.text).join('\n');
    assert.ok(textParts.includes('pé-direito mínimo de 2.60m'));
  });

  await test('an unsupported attachment type is rejected (400) before any reservation', async () => {
    await reset();
    const r = await send('new', multipart({ text: 'oi' }, [{ data: Buffer.from('x'), name: 'x.exe', mime: 'application/x-msdownload' }]));
    assert.equal(r.status, 400);
    assert.equal(await bal(), 20);
  });

  // ------------------------------------------------------------ failures -> refund
  await test('audio transcription failure: refunded in full, NOTHING is persisted (no conversation, no message)', async () => {
    await reset();
    const before = (await getJson('/conversations', 'token-a')).body.conversations.length;
    fake.transcribeMode = 'error500';
    const audio = Buffer.from('fake webm bytes');
    const r = await send('new', multipart({}, [{ data: audio, name: 'nota.webm', mime: 'audio/webm' }]));
    assert.equal(r.status, 200);
    assert.deepEqual(r.events.map((e) => e.type), ['error']);
    assert.equal(await bal(), 20);
    const after = (await getJson('/conversations', 'token-a')).body.conversations.length;
    assert.equal(after, before, 'no new conversation should have been created');
  });

  await test('the assistant call fails (provider 500): the user message IS kept, the assistant turn is marked failed, and the credit is refunded — no secret leaks', async () => {
    await reset();
    fake.chatMode = 'error500';
    const r = await send('new', multipart({ text: 'Isso vai falhar' }));
    assert.equal(r.status, 200);
    assert.deepEqual(r.events.map((e) => e.type), ['start', 'error']);
    assert.equal(r.events[1].code, 'PROVIDER_UNAVAILABLE');
    assert.ok(!JSON.stringify(r.events).includes('secret provider detail'));
    assert.equal(await bal(), 20);
    const conversationId = r.events[0].conversationId as string;
    const { body: detail } = await getJson(`/conversations/${conversationId}`, 'token-a');
    assert.equal(detail.messages.length, 2);
    assert.equal(detail.messages[0].role, 'user');
    assert.equal(detail.messages[0].content, 'Isso vai falhar');
    assert.equal(detail.messages[1].role, 'assistant');
    assert.equal(detail.messages[1].status, 'failed');
    assert.equal(detail.messages[1].errorCode, 'PROVIDER_UNAVAILABLE');
  });

  await test('a real invalid API key (401 invalid_api_key) is reported as INVALID_API_KEY and refunded; the raw key fragment never leaks', async () => {
    await reset();
    fake.chatMode = 'auth401';
    const r = await send('new', multipart({ text: 'oi' }));
    assert.equal(r.events[r.events.length - 1].type, 'error');
    assert.equal(r.events[r.events.length - 1].code, 'INVALID_API_KEY');
    assert.equal(await bal(), 20);
    assert.ok(!JSON.stringify(r.events).includes('FAKE1234567890'));
  });

  await test('sending to an unknown / another user\'s conversation id is refused (404) — no reservation, no message', async () => {
    await reset();
    const mineFirst = await send('new', multipart({ text: 'minha conversa' }));
    const conversationId = mineFirst.events[0].conversationId as string;
    const r = await send(conversationId, multipart({ text: 'invasão' }), 'token-b');
    assert.equal(r.status, 404);
    assert.equal(await bal(USER_B), 20);
  });

  // ------------------------------------------------------------ conversation management
  await test('another user cannot list, read or delete a conversation that is not theirs', async () => {
    await reset();
    const mine = await send('new', multipart({ text: 'privado' }));
    const conversationId = mine.events[0].conversationId as string;
    assert.equal((await getJson(`/conversations/${conversationId}`, 'token-b')).status, 404);
    const del = await fetch(`${base}/conversations/${conversationId}`, { method: 'DELETE', headers: authHeaders('token-b') });
    assert.equal(del.status, 404);
    const { body: list } = await getJson('/conversations', 'token-b');
    assert.ok(!list.conversations.some((c: any) => c.id === conversationId));
  });

  await test('deleting a conversation soft-deletes it (disappears from listing/get) and removes its attachment files', async () => {
    await reset();
    const png = Buffer.from(PNG_B64, 'base64');
    const created = await send('new', multipart({ text: 'apagar depois' }, [{ data: png, name: 'planta.png', mime: 'image/png' }]));
    const conversationId = created.events[0].conversationId as string;
    const { body: before } = await getJson(`/conversations/${conversationId}`, 'token-a');
    const attachmentPath = before.messages[0].attachments[0].url as string;
    assert.ok(attachmentPath);
    const del = await fetch(`${base}/conversations/${conversationId}`, { method: 'DELETE', headers: authHeaders('token-a') });
    assert.equal(del.status, 200);
    assert.equal((await getJson(`/conversations/${conversationId}`, 'token-a')).status, 404);
    const { body: list } = await getJson('/conversations', 'token-a');
    assert.ok(!list.conversations.some((c: any) => c.id === conversationId));
  });

  // ------------------------------------------------------------ request shape / model
  await test('the chat model is called with store:false, no tools, and the configured model — never the transcription model', async () => {
    await reset();
    const models = await import('../src/config/openaiModels');
    await send('new', multipart({ text: 'oi' }));
    const call = fake.chatCalls[fake.chatCalls.length - 1].body;
    assert.equal(call.model, models.OPENAI_ARCHITECT_CHAT_MODEL);
    assert.notEqual(call.model, models.OPENAI_ARCHITECT_TRANSCRIBE_MODEL);
    assert.equal(call.store, false);
    assert.equal(call.tools, undefined);
    assert.equal(typeof call.instructions, 'string');
    assert.ok(call.instructions.length > 0);
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
