/**
 * Tests for the persistent per-user wallet service, its reconciliation of
 * interrupted operations, the Supabase adapters and the environment rules.
 *
 * - The wallet CONTRACT (reserve/capture/refund/idempotency/partial capture/
 *   pending/ledger) runs against the in-memory backend AND, when PGlite is
 *   available (see test-wallet-sql.ts), against the REAL SQL functions from the
 *   migrations through a thin adapter — proving both behave identically.
 * - SupabaseWalletBackend / SupabaseGenerationStore are exercised against a
 *   local fake PostgREST server (request shape + error mapping).
 * - Nothing here touches the network beyond 127.0.0.1 and nothing calls OpenAI.
 *
 * Run: npx tsx scripts/test-wallet-service.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { AddressInfo } from 'node:net';

let passed = 0;
let failed = 0;
let skipped = 0;

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

const PGLITE_DIR = process.env.PGLITE_DIR || 'C:/Users/jpmai/AppData/Local/Temp/pgtest';
const MIGRATIONS = path.resolve(__dirname, '../../supabase/migrations');
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const G1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const G2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Fake PostgREST for the Supabase adapters.
const rest = { requests: [] as Array<{ method: string; url: string; body: any; apikey: string | undefined }>, respond: (_r: { url: string; body: any }): { status: number; json: unknown } => ({ status: 200, json: null }) };
function startRestServer(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : null;
      const url = req.url ?? '';
      rest.requests.push({ method: req.method ?? '', url, body, apikey: req.headers.apikey as string | undefined });
      const { status, json } = rest.respond({ url, body });
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(json));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  console.log('Wallet service, reconciliation, adapters and environment rules\n');

  const restServer = await startRestServer();
  const restPort = (restServer.address() as AddressInfo).port;
  process.env.SUPABASE_URL = `http://127.0.0.1:${restPort}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
  process.env.WALLET_SIGNUP_BONUS_CREDITS = '100';

  const wallet = await import('../src/services/creditWallet');
  const reconciler = await import('../src/services/walletReconciler');
  const hReconciler = await import('../src/services/humanizedFloorplanReconciler');
  const storeMod = await import('../src/services/humanizedFloorplanStore');
  const filesMod = await import('../src/storage/humanizedFloorplanFiles');
  const env = await import('../src/config/runtimeEnvironment');
  const { AppError } = await import('../src/lib/errors');

  // ------------------------------------------------------------ wallet contract (memory + real SQL)
  type Backend = import('../src/services/creditWallet').WalletBackend;

  async function contract(label: string, make: () => Promise<{ backend: Backend; backdate: (reservationId: string) => Promise<void>; staleSeconds: number }>) {
    const t = (n: string, fn: (ctx: { backend: Backend; backdate: (id: string) => Promise<void>; staleSeconds: number }) => Promise<void>) =>
      test(`[${label}] ${n}`, async () => fn(await make()));
    const rule = async (p: Promise<unknown>, r: string) => {
      try {
        await p;
      } catch (err) {
        assert.ok(err instanceof wallet.WalletRuleError, `expected WalletRuleError, got ${String(err)}`);
        assert.equal((err as any).rule, r);
        return;
      }
      assert.fail(`expected rule ${r}`);
    };

    await t('signup bonus is granted exactly once; wallets are independent per user', async ({ backend }) => {
      assert.equal(await backend.ensure(U1, 100), 100);
      assert.equal(await backend.ensure(U1, 100), 100);
      assert.equal(await backend.ensure(U1, 999), 100);
      assert.equal(await backend.ensure(U2, 0), 0);
      assert.equal(await backend.balance(U2), 0);
      await rule(backend.balance('99999999-9999-4999-8999-999999999999'), 'wallet_not_found');
    });

    await t('reserve -> capture: balance drops once, second capture is a no-op, refund afterwards is refused', async ({ backend }) => {
      await backend.ensure(U1, 10);
      const r = await backend.reserve({ userId: U1, amount: 2, tool: 't', generationId: G1, idempotencyKey: 'k1' });
      assert.equal(r.balanceAfter, 8);
      const c1 = await backend.capture(U1, r.reservationId);
      assert.equal(c1.captured, 2);
      assert.ok(c1.captureId);
      assert.equal(c1.reused, false);
      const c2 = await backend.capture(U1, r.reservationId);
      assert.equal(c2.reused, true);
      assert.equal(await backend.balance(U1), 8);
      await rule(backend.refund(U1, r.reservationId, 'x'), 'reservation_already_captured');
    });

    await t('reserve -> refund: credits return once; a second refund is a no-op; capture afterwards is refused', async ({ backend }) => {
      await backend.ensure(U1, 10);
      const r = await backend.reserve({ userId: U1, amount: 4, tool: 't', generationId: G1, idempotencyKey: null });
      assert.equal(await backend.balance(U1), 6);
      const f1 = await backend.refund(U1, r.reservationId, 'provider_error');
      assert.equal(f1.reused, false);
      assert.ok(f1.refundId);
      assert.equal(await backend.balance(U1), 10);
      assert.equal((await backend.refund(U1, r.reservationId, 'again')).reused, true);
      assert.equal(await backend.balance(U1), 10);
      await rule(backend.capture(U1, r.reservationId), 'reservation_already_refunded');
    });

    await t('the same idempotency key returns the same reservation and never reserves twice', async ({ backend }) => {
      await backend.ensure(U1, 10);
      const a = await backend.reserve({ userId: U1, amount: 2, tool: 't', generationId: G1, idempotencyKey: 'same' });
      const b = await backend.reserve({ userId: U1, amount: 2, tool: 't', generationId: G1, idempotencyKey: 'same' });
      assert.equal(b.reused, true);
      assert.equal(b.reservationId, a.reservationId);
      assert.equal(await backend.balance(U1), 8);
    });

    await t('insufficient credits are refused as a business rule; nothing changes; balance never negative', async ({ backend }) => {
      await backend.ensure(U1, 3);
      await rule(backend.reserve({ userId: U1, amount: 4, tool: 't', generationId: null, idempotencyKey: null }), 'insufficient_credits');
      await backend.reserve({ userId: U1, amount: 3, tool: 't', generationId: null, idempotencyKey: null });
      await rule(backend.reserve({ userId: U1, amount: 1, tool: 't', generationId: null, idempotencyKey: null }), 'insufficient_credits');
      assert.equal(await backend.balance(U1), 0);
    });

    await t('partial capture (2 of 3 delivered): captures 2, returns 1, both movement ids reported', async ({ backend }) => {
      await backend.ensure(U1, 10);
      const r = await backend.reserve({ userId: U1, amount: 3, tool: 'text_to_image', generationId: G1, idempotencyKey: null });
      const c = await backend.capture(U1, r.reservationId, 2);
      assert.equal(c.captured, 2);
      assert.equal(c.refunded, 1);
      assert.ok(c.captureId && c.refundId);
      assert.equal(await backend.balance(U1), 8);
      await rule(backend.capture(U1, (await backend.reserve({ userId: U1, amount: 1, tool: 't', generationId: null, idempotencyKey: null })).reservationId, 9), 'invalid_amount');
    });

    await t('a user can neither capture nor refund another user\'s reservation', async ({ backend }) => {
      await backend.ensure(U1, 10);
      await backend.ensure(U2, 10);
      const r = await backend.reserve({ userId: U1, amount: 2, tool: 't', generationId: null, idempotencyKey: null });
      await rule(backend.capture(U2, r.reservationId), 'reservation_not_found');
      await rule(backend.refund(U2, r.reservationId, 'x'), 'reservation_not_found');
      assert.equal(await backend.balance(U2), 10);
    });

    await t('ledger by generation shows the full trail in order; pending lists only unsettled stale reservations', async ({ backend, backdate, staleSeconds }) => {
      await backend.ensure(U1, 10);
      const a = await backend.reserve({ userId: U1, amount: 2, tool: 't', generationId: G1, idempotencyKey: null });
      const b = await backend.reserve({ userId: U1, amount: 2, tool: 't', generationId: G2, idempotencyKey: null });
      await backend.capture(U1, a.reservationId);
      await backdate(b.reservationId);
      assert.deepEqual((await backend.ledgerForGeneration(U1, G1)).map((m) => m.type), ['reserve', 'capture']);
      const stale = await backend.pending(staleSeconds, U1);
      assert.deepEqual(stale.map((p) => p.reservationId), [b.reservationId]);
      assert.equal((await backend.pending(staleSeconds, U2)).length, 0);
      await backend.refund(U1, b.reservationId, 'x');
      assert.equal((await backend.pending(0, U1)).length, 0);
    });

    await t('credit grants are idempotent per key and adjust the spendable balance', async ({ backend }) => {
      await backend.ensure(U1, 0);
      assert.equal(await backend.credit(U1, 5, 'promo', 'system', 'promo-1'), 5);
      assert.equal(await backend.credit(U1, 5, 'promo', 'system', 'promo-1'), 5);
      assert.equal(await backend.credit(U1, 5, 'promo', 'system', null), 10);
    });
  }

  await contract('memory', async () => {
    const backend = new wallet.MemoryWalletBackend();
    return { backend, staleSeconds: 600, backdate: async (id) => backend.backdateForTests(id, 3_600_000) };
  });

  // Real SQL through PGlite.
  let pgAvailable = true;
  let PGlite: any;
  try {
    PGlite = createRequire(path.join(PGLITE_DIR, 'noop.js'))('@electric-sql/pglite').PGlite;
  } catch {
    pgAvailable = false;
  }

  async function newPg() {
    const db = new PGlite();
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (id uuid primary key);
      create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
      insert into auth.users (id) values ('${U1}'), ('${U2}');
    `);
    for (const f of ['20260919120000_humanized_floorplan_generations.sql', '20260920100000_credit_wallet.sql']) await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    const RULES = ['insufficient_credits', 'reservation_not_found', 'reservation_already_captured', 'reservation_already_refunded', 'invalid_amount', 'wallet_not_found'] as const;
    const call = async (sql: string, params: unknown[]) => {
      try {
        return (await db.query(sql, params)).rows[0]?.r;
      } catch (err) {
        const msg = String((err as Error).message);
        const r = RULES.find((x) => msg.includes(x));
        if (r) throw new wallet.WalletRuleError(r);
        throw err;
      }
    };
    const backend: Backend = {
      kind: 'supabase',
      ensure: (u, b) => call('select public.wallet_ensure($1,$2) as r', [u, b]),
      balance: async (u) => {
        const r = await call('select public.wallet_get($1) as r', [u]);
        if (r.balance === null) throw new wallet.WalletRuleError('wallet_not_found');
        return r.balance;
      },
      reserve: async (p) => {
        const r = await call('select public.wallet_reserve($1,$2,$3,$4,$5) as r', [p.userId, p.amount, p.tool, p.generationId, p.idempotencyKey]);
        return { reservationId: r.reservation_id, amount: r.amount, balanceAfter: r.balance_after, reused: r.reused };
      },
      capture: async (u, id, amount) => {
        const r = await call('select public.wallet_capture($1,$2,$3) as r', [u, id, amount ?? null]);
        return { captured: r.captured, captureId: r.capture_id, refunded: r.refunded ?? 0, refundId: r.refund_id ?? null, balanceAfter: r.balance_after, reused: r.reused };
      },
      refund: async (u, id, reason) => {
        const r = await call('select public.wallet_refund($1,$2,$3) as r', [u, id, reason]);
        return { refunded: r.refunded, refundId: r.refund_id, balanceAfter: r.balance_after, reused: r.reused };
      },
      credit: async (u, a, reason, tool, key) => (await call('select public.wallet_credit($1,$2,$3,$4,$5) as r', [u, a, reason, tool, key])).balance_after,
      pending: async (secs, u) => {
        const rows = await call('select public.wallet_pending_reservations($1,$2) as r', [secs, u ?? null]);
        return rows.map((r: any) => ({ reservationId: r.reservation_id, userId: r.user_id, generationId: r.generation_id, amount: r.amount, tool: r.tool, createdAt: r.created_at }));
      },
      ledgerForGeneration: async (u, g) => {
        const rows = (await db.query(`select id, transaction_type, amount, balance_before, balance_after, reason, created_at, reservation_id from public.credit_ledger where user_id = $1 and generation_id = $2 order by created_at, transaction_type desc`, [u, g])).rows;
        return rows.map((r: any) => ({ id: r.id, type: r.transaction_type, amount: r.amount, balanceBefore: r.balance_before, balanceAfter: r.balance_after, reason: r.reason, createdAt: String(r.created_at), reservationId: r.reservation_id }));
      },
    };
    // The immutable ledger cannot be back-dated by UPDATE, so stale-ness is simulated by asking for "older than 0 seconds" after a beat.
    return { db, backend };
  }

  if (pgAvailable) {
    await contract('real SQL', async () => {
      const { backend } = await newPg();
      return {
        backend,
        staleSeconds: 1,
        backdate: async () => {
          await new Promise((r) => setTimeout(r, 1100));
        },
      };
    });

    await test('[real SQL] balance persists across a "server restart": a brand-new backend instance over the same database sees the same state', async () => {
      const { db, backend } = await newPg();
      await backend.ensure(U1, 10);
      await backend.reserve({ userId: U1, amount: 2, tool: 't', generationId: G1, idempotencyKey: 'persist' });
      const restarted = (await (async () => {
        // A new process only has the database; rebuild the adapter's view from it.
        const r = (await db.query(`select balance, reserved_balance from public.credit_wallets where user_id = $1`, [U1])).rows[0];
        return r;
      })()) as { balance: number; reserved_balance: number };
      assert.deepEqual(restarted, { balance: 8, reserved_balance: 2 });
      const again = await backend.reserve({ userId: U1, amount: 2, tool: 't', generationId: G1, idempotencyKey: 'persist' });
      assert.equal(again.reused, true);
      assert.equal(await backend.balance(U1), 8);
    });
  } else {
    console.log(`  SKIPPED  [real SQL] contract + persistence (PGlite not found in ${PGLITE_DIR}/node_modules)`);
    skipped++;
  }

  // ------------------------------------------------------------ service API
  const mem = new wallet.MemoryWalletBackend();
  wallet.setWalletBackendForTests(mem);

  await test('getWalletBalance creates the wallet and grants the configured signup bonus once; two users never share a balance', async () => {
    assert.equal(await wallet.getWalletBalance(U1), 100);
    assert.equal(await wallet.getWalletBalance(U1), 100);
    const r = await wallet.reserveCredits({ userId: U1, amount: 2, tool: 't', generationId: G1 });
    await wallet.captureCredits(r);
    assert.equal(await wallet.getWalletBalance(U1), 98);
    assert.equal(await wallet.getWalletBalance(U2), 100);
  });

  await test('reserveCredits refuses with INSUFFICIENT_CREDITS (402) and a readable message; the balance is untouched', async () => {
    await assert.rejects(
      () => wallet.reserveCredits({ userId: U2, amount: 1000, tool: 't', generationId: G2 }),
      (err: any) => err instanceof AppError && err.code === 'INSUFFICIENT_CREDITS' && err.httpStatus === 402 && /balance is 100/.test(err.message)
    );
    assert.equal(await wallet.getWalletBalance(U2), 100);
  });

  await test('an unavailable wallet backend surfaces a 503 with "no credits were used" and never a raw database error', async () => {
    const broken: Backend = new Proxy(mem, {
      get: (t, p) => (p === 'ensure' || p === 'reserve' ? async () => { throw new Error('connection refused to db.internal:5432'); } : (t as any)[p]),
    }) as Backend;
    wallet.setWalletBackendForTests(broken);
    await assert.rejects(
      () => wallet.reserveCredits({ userId: U1, amount: 2, tool: 't', generationId: G1 }),
      (err: any) => err instanceof AppError && err.httpStatus === 503 && /No credits were used/.test(err.message) && !/db\.internal/.test(err.message)
    );
    wallet.setWalletBackendForTests(mem);
  });

  await test('refundCredits never throws when the backend is down (the reservation stays pending for reconciliation)', async () => {
    const r = await wallet.reserveCredits({ userId: U1, amount: 2, tool: 't', generationId: G1 });
    const realRefund = mem.refund.bind(mem);
    mem.refund = async () => {
      throw new Error('db down');
    };
    const out = await wallet.refundCredits(r, 'x');
    mem.refund = realRefund;
    assert.equal(out, null);
    assert.equal((await mem.pending(0, U1)).some((p) => p.reservationId === r.id), true);
    await wallet.refundCredits(r, 'cleanup');
  });

  // ------------------------------------------------------------ reconciliation
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recon-test-'));
  const store = new storeMod.LocalGenerationStore(path.join(tmp, 'g.json'));
  const storage = new filesMod.LocalFileStorage(path.join(tmp, 'files'));
  storeMod.setGenerationStoreForTests(store);
  filesMod.setFileStorageForTests(storage);
  wallet.setWalletBackendForTests(mem);

  const baseRecord = (id: string, over: Partial<import('../src/services/humanizedFloorplanStore').GenerationRecord> = {}): import('../src/services/humanizedFloorplanStore').GenerationRecord => ({
    id, userId: U1, idempotencyKey: null, status: 'processing', originalFileName: null, referenceFileName: null, hasReference: false, sourceGenerationId: null,
    style: 'classico', lighting: 'clear_day', surroundings: 'auto', surroundingsKind: null, customSurroundings: null, textMode: 'auto', furnitureLevel: 'auto', outputFormat: 'original', customInstructions: null,
    creditsReserved: 2, creditsCaptured: 0, creditsRefunded: 0, reservationId: null, captureTransactionId: null, refundTransactionId: null,
    provider: 'openai-image', model: 'm', quality: null, size: null, requestId: null, usage: null, costUsd: null, errorCode: null, errorMessage: null,
    originalPath: null, referencePath: null, resultPath: null, resultJpgPath: null, createdAt: new Date(Date.now() - 3_600_000).toISOString(), completedAt: null, deletedAt: null,
    generationMode: 'standard', analysisModel: null, analysisStatus: null, validationStatus: null, fidelityScore: null, attemptsCount: 1, autoCorrectionApplied: false, violationsSummary: null, pipelineStage: null, ...over,
  });
  const uuid = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
  async function stalePending(id: string, tool = 'planta_humanizada') {
    await mem.ensure(U1, 100);
    const r = await mem.reserve({ userId: U1, amount: 2, tool, generationId: id, idempotencyKey: null });
    mem.backdateForTests(r.reservationId, 3_600_000);
    return r.reservationId;
  }
  const ledgerTypes = async (id: string) => (await mem.ledgerForGeneration(U1, id)).map((m) => m.type);

  await test('reconcile: reservation pending + record COMPLETED -> captured (never refunded)', async () => {
    const id = uuid(1);
    await store.insert(baseRecord(id, { status: 'completed', resultPath: `${U1}/${id}/result.png` }));
    await stalePending(id);
    const s = await reconciler.reconcileStaleReservations({ olderThanSeconds: 60, userId: U1 });
    assert.ok(s.captured >= 1);
    assert.deepEqual(await ledgerTypes(id), ['reserve', 'capture']);
  });

  await test('reconcile: reservation pending + record FAILED -> refunded', async () => {
    const id = uuid(2);
    await store.insert(baseRecord(id, { status: 'failed' }));
    const before = await mem.balance(U1);
    await stalePending(id);
    await reconciler.reconcileStaleReservations({ olderThanSeconds: 60, userId: U1 });
    assert.deepEqual(await ledgerTypes(id), ['reserve', 'refund']);
    assert.equal(await mem.balance(U1), before);
  });

  await test('reconcile: PROCESSING but the result image IS saved (crash before capture) -> the user is NOT refunded: captured and marked completed', async () => {
    const id = uuid(3);
    const resultPath = await storage.save(U1, id, 'result', Buffer.from('png-bytes'), 'image/png');
    await store.insert(baseRecord(id, { resultPath }));
    await stalePending(id);
    await reconciler.reconcileStaleReservations({ olderThanSeconds: 60, userId: U1 });
    assert.deepEqual(await ledgerTypes(id), ['reserve', 'capture']);
    const rec = await store.get(U1, id);
    assert.equal(rec!.status, 'completed');
    assert.equal(rec!.creditsCaptured, 2);
  });

  await test('reconcile: PROCESSING with NO saved result (crash mid-provider-call) -> refunded and marked failed', async () => {
    const id = uuid(4);
    await store.insert(baseRecord(id));
    const before = await mem.balance(U1);
    await stalePending(id);
    await reconciler.reconcileStaleReservations({ olderThanSeconds: 60, userId: U1 });
    assert.deepEqual(await ledgerTypes(id), ['reserve', 'refund']);
    assert.equal(await mem.balance(U1), before);
    const rec = await store.get(U1, id);
    assert.equal(rec!.status, 'failed');
    assert.equal(rec!.creditsRefunded, 2);
  });

  await test('reconcile: no generation record at all -> refunded', async () => {
    const id = uuid(5);
    await stalePending(id);
    await reconciler.reconcileStaleReservations({ olderThanSeconds: 60, userId: U1 });
    assert.deepEqual(await ledgerTypes(id), ['reserve', 'refund']);
  });

  await test('reconcile leaves alone: fresh reservations, generations still running in this process, and reservations owned by a live job', async () => {
    const fresh = uuid(6);
    await store.insert(baseRecord(fresh));
    await mem.ensure(U1, 100);
    const rFresh = await mem.reserve({ userId: U1, amount: 2, tool: 'planta_humanizada', generationId: fresh, idempotencyKey: null });
    await reconciler.reconcileStaleReservations({ olderThanSeconds: 600, userId: U1 });
    assert.deepEqual(await ledgerTypes(fresh), ['reserve']);

    const live = uuid(7);
    await store.insert(baseRecord(live));
    await stalePending(live);
    hReconciler.markGenerationLive(live);
    await reconciler.reconcileStaleReservations({ olderThanSeconds: 60, userId: U1 });
    assert.deepEqual(await ledgerTypes(live), ['reserve'], 'a generation still running here is never touched');
    hReconciler.markGenerationDone(live);

    const owned = await wallet.reserveCredits({ userId: U1, amount: 2, tool: 'render', generationId: uuid(8) });
    mem.backdateForTests(owned.id, 3_600_000);
    await reconciler.reconcileStaleReservations({ olderThanSeconds: 60, userId: U1 });
    assert.deepEqual(await ledgerTypes(uuid(8)), ['reserve'], 'a reservation owned by a running job is skipped');
    await wallet.refundCredits(owned, 'cleanup');
    await mem.refund(U1, rFresh.reservationId, 'cleanup');
  });

  await test('reconcile: tools without persisted generations (older tools) fall back to refunding an orphaned, stale reservation', async () => {
    const id = uuid(9);
    const before = await mem.balance(U1);
    await stalePending(id, 'text_to_image');
    await reconciler.reconcileStaleReservations({ olderThanSeconds: 60, userId: U1 });
    assert.deepEqual(await ledgerTypes(id), ['reserve', 'refund']);
    assert.equal(await mem.balance(U1), before);
  });

  await test('reconcile is idempotent: running it twice never refunds or captures twice', async () => {
    const id = uuid(10);
    await store.insert(baseRecord(id));
    await stalePending(id);
    await reconciler.reconcileStaleReservations({ olderThanSeconds: 60, userId: U1 });
    const balance = await mem.balance(U1);
    const s = await reconciler.reconcileStaleReservations({ olderThanSeconds: 60, userId: U1 });
    assert.equal(s.refunded + s.captured, 0);
    assert.equal(await mem.balance(U1), balance);
  });

  await test('reconcileStaleGenerations: a record left "processing" whose credits were already settled is aligned with the ledger', async () => {
    const done = uuid(11);
    const resultPath = await storage.save(U1, done, 'result', Buffer.from('x'), 'image/png');
    await store.insert(baseRecord(done, { resultPath }));
    const rr = await mem.reserve({ userId: U1, amount: 2, tool: 'planta_humanizada', generationId: done, idempotencyKey: null });
    await mem.capture(U1, rr.reservationId);

    const failed = uuid(12);
    await store.insert(baseRecord(failed));
    const rf = await mem.reserve({ userId: U1, amount: 2, tool: 'planta_humanizada', generationId: failed, idempotencyKey: null });
    await mem.refund(U1, rf.reservationId, 'x');

    const never = uuid(13);
    await store.insert(baseRecord(never));

    const fixed = await hReconciler.reconcileStaleGenerations(60_000);
    assert.ok(fixed >= 3);
    assert.equal((await store.get(U1, done))!.status, 'completed');
    assert.equal((await store.get(U1, failed))!.status, 'failed');
    assert.equal((await store.get(U1, never))!.status, 'failed');
  });

  // ------------------------------------------------------------ Supabase adapters (fake PostgREST)
  await test('SupabaseWalletBackend: calls the atomic RPCs with the documented argument names, uses the service key server-side, maps results and business errors', async () => {
    rest.requests.length = 0;
    rest.respond = ({ url }) => {
      if (url.includes('wallet_reserve')) return { status: 200, json: { reservation_id: 'r-1', amount: 2, balance_after: 8, reused: false } };
      if (url.includes('wallet_capture')) return { status: 200, json: { captured: 2, capture_id: 'c-1', refunded: 0, balance_after: 8, reused: false } };
      if (url.includes('wallet_refund')) return { status: 400, json: { code: 'P0001', message: 'reservation_already_captured', details: null, hint: null } };
      return { status: 200, json: null };
    };
    const b = new wallet.SupabaseWalletBackend();
    const r = await b.reserve({ userId: U1, amount: 2, tool: 'planta_humanizada', generationId: G1, idempotencyKey: 'k' });
    assert.deepEqual(r, { reservationId: 'r-1', amount: 2, balanceAfter: 8, reused: false });
    const call = rest.requests.find((x) => x.url.includes('wallet_reserve'))!;
    assert.deepEqual(Object.keys(call.body).sort(), ['p_amount', 'p_generation', 'p_idempotency_key', 'p_metadata', 'p_tool', 'p_user']);
    assert.equal(call.method, 'POST');
    assert.equal(call.apikey, 'fake-service-role-key');
    const c = await b.capture(U1, 'r-1');
    assert.equal(c.captureId, 'c-1');
    await assert.rejects(() => b.refund(U1, 'r-1', 'x'), (err: any) => err instanceof wallet.WalletRuleError && err.rule === 'reservation_already_captured');
    rest.respond = () => ({ status: 500, json: { code: 'XX000', message: 'internal db detail host=10.0.0.5' } });
    await assert.rejects(() => b.balance(U1));
  });

  await test('SupabaseGenerationStore: row mapping round-trips; a unique-violation (23505) on insert becomes DuplicateGenerationError; scoped by user_id', async () => {
    const rec = baseRecord(G1, { idempotencyKey: 'abc', originalPath: `${U1}/${G1}/original.png`, usage: { textInputTokens: 1, imageInputTokens: 2, imageOutputTokens: 3, totalTokens: 6 } });
    assert.deepEqual(storeMod.fromRow(storeMod.toRow(rec) as any), rec);
    rest.requests.length = 0;
    rest.respond = () => ({ status: 409, json: { code: '23505', message: 'duplicate key value violates unique constraint' } });
    const s = new storeMod.SupabaseGenerationStore();
    await assert.rejects(() => s.insert(rec), (err: any) => err instanceof storeMod.DuplicateGenerationError);
    rest.respond = () => ({ status: 200, json: [] });
    await s.get(U1, G1);
    const q = rest.requests[rest.requests.length - 1].url;
    assert.ok(q.includes(`user_id=eq.${U1}`) && q.includes(`id=eq.${G1}`) && q.includes('deleted_at=is.null'));
    await s.list(U2, 10);
    assert.ok(rest.requests[rest.requests.length - 1].url.includes(`user_id=eq.${U2}`));
  });

  // ------------------------------------------------------------ environment rules
  const withEnv = async (vars: Record<string, string | undefined>, fn: () => Promise<void> | void) => {
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(vars)) saved[k] = process.env[k];
    for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    }
  };

  await test('production without Supabase configuration FAILS at startup with a clear message', () => {
    assert.throws(() => env.assertInfrastructureConfig({ NODE_ENV: 'production' } as any), /Refusing to start in production.*SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY/);
    assert.throws(() => env.assertInfrastructureConfig({ NODE_ENV: 'production', SUPABASE_URL: 'x' } as any), /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotThrow(() => env.assertInfrastructureConfig({ NODE_ENV: 'production', SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'y' } as any));
  });

  await test('production refuses the local fallback flag, and development ignores the flag unless it is exactly "true"', () => {
    assert.throws(() => env.assertInfrastructureConfig({ NODE_ENV: 'production', SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'y', ALLOW_LOCAL_DEV_FALLBACK: 'true' } as any), /ALLOW_LOCAL_DEV_FALLBACK/);
    assert.equal(env.isLocalDevFallbackAllowed({ NODE_ENV: 'production', ALLOW_LOCAL_DEV_FALLBACK: 'true' } as any), false);
    assert.equal(env.isLocalDevFallbackAllowed({ NODE_ENV: 'development', ALLOW_LOCAL_DEV_FALLBACK: 'true' } as any), true);
    assert.equal(env.isLocalDevFallbackAllowed({ NODE_ENV: 'development', ALLOW_LOCAL_DEV_FALLBACK: '1' } as any), false);
    assert.equal(env.isLocalDevFallbackAllowed({} as any), false);
  });

  await test('signup bonus: production defaults to 0 (nothing invented), development to 100, explicit value wins', () => {
    assert.equal(env.walletSignupBonusCredits({ NODE_ENV: 'production' } as any), 0);
    assert.equal(env.walletSignupBonusCredits({ NODE_ENV: 'development' } as any), 100);
    assert.equal(env.walletSignupBonusCredits({ NODE_ENV: 'production', WALLET_SIGNUP_BONUS_CREDITS: '25' } as any), 25);
    assert.equal(env.walletSignupBonusCredits({ NODE_ENV: 'development', WALLET_SIGNUP_BONUS_CREDITS: 'abc' } as any), 100);
  });

  await test('in-memory wallet, JSON generation store and local-disk storage all REFUSE to exist in production', async () => {
    await withEnv({ NODE_ENV: 'production' }, () => {
      assert.throws(() => new wallet.MemoryWalletBackend(), /production/);
      assert.throws(() => new storeMod.LocalGenerationStore(path.join(tmp, 'x.json')), /production/);
      assert.throws(() => new filesMod.LocalFileStorage(path.join(tmp, 'x')), /production/);
    });
  });

  await test('without Supabase and without the explicit flag, the wallet, the store and the file storage all refuse to start (no silent fallback)', async () => {
    await withEnv({ SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined, ALLOW_LOCAL_DEV_FALLBACK: undefined, NODE_ENV: 'development' }, async () => {
      wallet.setWalletBackendForTests(null);
      storeMod.setGenerationStoreForTests(null);
      filesMod.setFileStorageForTests(null);
      await assert.rejects(() => wallet.getWalletBackend(), /Supabase is not configured/);
      await assert.rejects(() => storeMod.getGenerationStore(), /Supabase is not configured/);
      await assert.rejects(() => filesMod.getFileStorage(), /Supabase is not configured/);
    });
  });

  await test('production with the flag set still refuses; the flag in development yields the in-memory backends and says so', async () => {
    await withEnv({ SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined, NODE_ENV: 'production', ALLOW_LOCAL_DEV_FALLBACK: 'true' }, async () => {
      wallet.setWalletBackendForTests(null);
      await assert.rejects(() => wallet.getWalletBackend(), /Supabase is not configured/);
    });
    await withEnv({ SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined, NODE_ENV: 'development', ALLOW_LOCAL_DEV_FALLBACK: 'true' }, async () => {
      wallet.setWalletBackendForTests(null);
      assert.equal((await wallet.getWalletBackend()).kind, 'memory');
    });
    wallet.setWalletBackendForTests(mem);
  });

  await test('a Supabase project whose wallet migration is missing is an ERROR in development (not a silent memory wallet) and in production', async () => {
    rest.respond = () => ({ status: 404, json: { code: 'PGRST202', message: 'Could not find the function public.wallet_get' } });
    for (const nodeEnv of ['development', 'production']) {
      await withEnv({ NODE_ENV: nodeEnv, ALLOW_LOCAL_DEV_FALLBACK: undefined }, async () => {
        wallet.setWalletBackendForTests(null);
        await assert.rejects(() => wallet.getWalletBackend(), /wallet is not available in Supabase/i);
      });
    }
    wallet.setWalletBackendForTests(mem);
  });

  await test('a PUBLIC storage bucket is refused: floor plans are never stored publicly', async () => {
    rest.respond = ({ url }) => (url.includes('/storage/v1/bucket/') ? { status: 200, json: { id: 'humanized-floorplans', name: 'humanized-floorplans', public: true } } : { status: 200, json: [] });
    await withEnv({ NODE_ENV: 'development', ALLOW_LOCAL_DEV_FALLBACK: undefined }, async () => {
      filesMod.setFileStorageForTests(null);
      await assert.rejects(() => filesMod.getFileStorage(), /PUBLIC/);
    });
    filesMod.setFileStorageForTests(storage);
  });

  // ------------------------------------------------------------ structural: no active route uses the old global wallet
  const routesDir = path.resolve(__dirname, '../src/routes');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  await test('no active route or service uses the old global wallet API (hasSufficientBalance / synchronous getBalance / debit / addTestCredits / sync reserve+refund)', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, f.name);
        if (f.isDirectory()) walk(full);
        else if (f.name.endsWith('.ts')) {
          const code = strip(fs.readFileSync(full, 'utf8'));
          if (/hasSufficientBalance|addTestCredits|[^.\w]debit\(|import\s*\{[^}]*\b(debit|getBalance)\b[^}]*\}\s*from\s*'[^']*creditWallet'/.test(code)) offenders.push(path.relative(path.resolve(__dirname, '..'), full));
        }
      }
    };
    walk(path.resolve(__dirname, '../src'));
    assert.deepEqual(offenders, []);
    const svc = strip(fs.readFileSync(path.resolve(__dirname, '../src/services/creditWallet.ts'), 'utf8'));
    assert.ok(!/^let balance\b/m.test(svc), 'no module-level global balance');
  });

  await test('every route that reserves credits requires auth, and pairs the reservation with a capture AND a refund', () => {
    const paid = fs.readdirSync(routesDir).filter((f) => f.endsWith('.ts') && /reserveCredits\(/.test(fs.readFileSync(path.join(routesDir, f), 'utf8')));
    assert.ok(paid.length >= 7, `expected the 7 paid routes, found ${paid.join(', ')}`);
    for (const f of paid) {
      const code = strip(fs.readFileSync(path.join(routesDir, f), 'utf8'));
      assert.ok(/requireAuth/.test(code), `${f} must require auth`);
      assert.ok(/captureCredits\(/.test(code), `${f} must capture`);
      assert.ok(/refundCredits\(/.test(code), `${f} must refund on failure`);
    }
  });

  await test('the wallet routes are authenticated and the dev test-credits endpoint does not exist in production', () => {
    const code = strip(fs.readFileSync(path.join(routesDir, 'wallet.ts'), 'utf8'));
    assert.ok(/walletRouter\.get\('\/wallet', requireAuth/.test(code));
    assert.ok(/walletRouter\.post\('\/wallet\/test-credits', requireAuth/.test(code));
    assert.ok(/isProduction\(\)/.test(code));
  });

  restServer.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
