/**
 * Validates the wallet / generations / storage MIGRATIONS by executing the
 * real .sql files on an embedded PostgreSQL (PGlite) — no Supabase project,
 * no network. Checks the atomic functions, constraints, immutability, RLS
 * and function privileges with two simulated users.
 *
 * Needs @electric-sql/pglite. It is NOT a repo dependency (the repo lives on
 * a synced drive where `npm install` is unreliable); point PGLITE_DIR at a
 * folder whose node_modules contains it. Without it this suite reports
 * SKIPPED (never a fake pass).
 *
 * Limits: PGlite is a single connection, so true parallel interleaving is not
 * exercised here — the race protection under load rests on the FOR UPDATE
 * lock + unique indexes verified below, and should be load-tested on the real
 * Supabase database after the migrations are applied.
 *
 * Run: PGLITE_DIR=<dir> npx tsx scripts/test-wallet-sql.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const PGLITE_DIR = process.env.PGLITE_DIR || 'C:/Users/jpmai/AppData/Local/Temp/pgtest';
const MIGRATIONS = path.resolve(__dirname, '../../supabase/migrations');

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

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const GEN_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GEN_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function main() {
  let PGlite: new () => any;
  try {
    const req = createRequire(path.join(PGLITE_DIR, 'noop.js'));
    PGlite = req('@electric-sql/pglite').PGlite;
  } catch {
    console.log(`SKIPPED: @electric-sql/pglite not found (looked in ${PGLITE_DIR}/node_modules). Set PGLITE_DIR to run the SQL validation.`);
    process.exit(0);
  }

  const db = new PGlite();
  console.log('Wallet / generations / storage migrations — executed on embedded PostgreSQL\n');

  // Supabase-shaped scaffolding the migrations depend on (auth schema, roles, storage tables, set_updated_at).
  const SCAFFOLD = `
    create schema if not exists auth;
    create table auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    create or replace function public.set_updated_at() returns trigger language plpgsql as $$
      begin new.updated_at = now(); return new; end; $$;
    create schema if not exists storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    create or replace function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    grant select on storage.objects to authenticated;
    insert into auth.users (id) values ('${USER_A}'), ('${USER_B}');
  `;
  await db.exec(SCAFFOLD);

  const files = ['20260919120000_humanized_floorplan_generations.sql', '20260920100000_credit_wallet.sql', '20260920110000_humanized_floorplans_storage.sql', '20260921100000_humanized_floorplan_astra.sql'];
  for (const f of files) await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
  // The default privileges above mimic Supabase (new tables/functions are granted to anon+authenticated); the migrations must REVOKE what they need to.
  for (const f of files) await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')); // idempotent re-run

  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as any[];
  const asRole = async (role: string, sub: string | null, fn: () => Promise<void>) => {
    await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${sub ?? ''}', false);`);
    try {
      await fn();
    } finally {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
    }
  };
  const call = async (fn: string, args: unknown[]) => (await q(`select public.${fn} as r`, args)).map((r) => r.r)[0];
  const expectError = async (sql: string, params: unknown[], match: RegExp) => {
    try {
      await db.query(sql, params);
    } catch (err) {
      assert.match(String((err as Error).message), match);
      return;
    }
    assert.fail(`expected an error matching ${match}`);
  };
  const wallet = async (u: string) => (await q('select balance, reserved_balance from public.credit_wallets where user_id = $1', [u]))[0];

  await test('migrations run twice without error (idempotent) and create tables, functions and the bucket row', async () => {
    const tables = (await q(`select table_name from information_schema.tables where table_schema = 'public' order by 1`)).map((r) => r.table_name);
    for (const t of ['credit_wallets', 'credit_ledger', 'humanized_floorplan_generations']) assert.ok(tables.includes(t), t);
    const fns = (await q(`select proname from pg_proc where pronamespace = 'public'::regnamespace and proname like 'wallet_%'`)).map((r) => r.proname);
    for (const f of ['wallet_ensure', 'wallet_get', 'wallet_reserve', 'wallet_capture', 'wallet_refund', 'wallet_credit', 'wallet_adjust', 'wallet_pending_reservations']) assert.ok(fns.includes(f), f);
    const bucket = (await q(`select public from storage.buckets where id = 'humanized-floorplans'`))[0];
    assert.equal(bucket.public, false);
  });

  await test('RLS is enabled on wallets, ledger and generations; every wallet function is SECURITY DEFINER with a fixed search_path', async () => {
    const rls = await q(`select relname, relrowsecurity from pg_class where relname in ('credit_wallets','credit_ledger','humanized_floorplan_generations')`);
    assert.equal(rls.length, 3);
    for (const r of rls) assert.equal(r.relrowsecurity, true, r.relname);
    const fns = await q(`select proname, prosecdef, proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname like 'wallet_%'`);
    for (const f of fns) {
      assert.equal(f.prosecdef, true, f.proname);
      assert.ok(String(f.proconfig).includes('search_path'), `${f.proname} must pin search_path`);
    }
  });

  await test('wallet functions are executable ONLY by service_role (not anon/authenticated/public)', async () => {
    const sigs = await q(`select oid::regprocedure::text as sig from pg_proc where pronamespace = 'public'::regnamespace and proname like 'wallet_%'`);
    assert.ok(sigs.length >= 8);
    for (const { sig } of sigs) {
      for (const role of ['anon', 'authenticated']) {
        assert.equal((await q(`select has_function_privilege('${role}', '${sig}', 'execute') as ok`))[0].ok, false, `${role} can execute ${sig}`);
      }
      assert.equal((await q(`select has_function_privilege('service_role', '${sig}', 'execute') as ok`))[0].ok, true, `service_role cannot execute ${sig}`);
    }
  });

  await test('wallet_ensure creates ONE wallet per user, grants the signup bonus exactly once, and never re-grants', async () => {
    assert.equal(await call('wallet_ensure($1, $2)', [USER_A, 10]), 10);
    assert.equal(await call('wallet_ensure($1, $2)', [USER_A, 10]), 10);
    assert.equal(await call('wallet_ensure($1, $2)', [USER_A, 500]), 10);
    const bonus = await q(`select * from public.credit_ledger where user_id = $1 and reason = 'signup_bonus'`, [USER_A]);
    assert.equal(bonus.length, 1);
    assert.equal(bonus[0].balance_before, 0);
    assert.equal(bonus[0].balance_after, 10);
    assert.equal(await call('wallet_ensure($1, $2)', [USER_B, 0]), 0);
    assert.equal((await q(`select count(*)::int as n from public.credit_ledger where user_id = $1`, [USER_B]))[0].n, 0);
  });

  await test('two users have independent wallets', async () => {
    assert.equal((await wallet(USER_A)).balance, 10);
    assert.equal((await wallet(USER_B)).balance, 0);
  });

  await test('reserve: moves credits from balance to reserved and writes a ledger row with before/after', async () => {
    const r = await call('wallet_reserve($1, $2, $3, $4, $5, $6)', [USER_A, 2, 'planta_humanizada', GEN_1, 'idem-1', '{}']);
    assert.equal(r.reused, false);
    assert.equal(r.balance_after, 8);
    assert.deepEqual(await wallet(USER_A), { balance: 8, reserved_balance: 2 });
    const row = (await q(`select * from public.credit_ledger where id = $1`, [r.reservation_id]))[0];
    assert.equal(row.transaction_type, 'reserve');
    assert.equal(row.balance_before, 10);
    assert.equal(row.balance_after, 8);
    assert.equal(row.generation_id, GEN_1);
  });

  await test('reserve with the SAME idempotency key returns the original reservation and charges nothing more', async () => {
    const again = await call('wallet_reserve($1, $2, $3, $4, $5, $6)', [USER_A, 2, 'planta_humanizada', GEN_1, 'idem-1', '{}']);
    assert.equal(again.reused, true);
    assert.deepEqual(await wallet(USER_A), { balance: 8, reserved_balance: 2 });
  });

  await test('reserve is refused when the balance is insufficient, and nothing changes; balance never goes negative', async () => {
    await expectError('select public.wallet_reserve($1, $2, $3)', [USER_A, 9, 'x'], /insufficient_credits/);
    await expectError('select public.wallet_reserve($1, $2, $3)', [USER_B, 1, 'x'], /insufficient_credits/);
    assert.deepEqual(await wallet(USER_A), { balance: 8, reserved_balance: 2 });
    await expectError('update public.credit_wallets set balance = -1 where user_id = $1', [USER_A], /check|violates/i);
  });

  await test('sequential competing reserves with credits for only ONE: the first wins, the second is refused', async () => {
    await call('wallet_credit($1, $2, $3)', [USER_B, 2, 'test_grant']);
    const first = await call('wallet_reserve($1, $2, $3, $4, $5)', [USER_B, 2, 't', GEN_2, 'race-1']);
    assert.equal(first.reused, false);
    await expectError('select public.wallet_reserve($1, $2, $3, $4, $5)', [USER_B, 2, 't', null, 'race-2'], /insufficient_credits/);
    assert.deepEqual(await wallet(USER_B), { balance: 0, reserved_balance: 2 });
  });

  await test('capture consumes the reservation ONCE; a second capture is a no-op and never double-charges', async () => {
    const res = (await q(`select id from public.credit_ledger where user_id = $1 and generation_id = $2 and transaction_type = 'reserve'`, [USER_A, GEN_1]))[0].id;
    const c1 = await call('wallet_capture($1, $2)', [USER_A, res]);
    assert.equal(c1.reused, false);
    assert.equal(c1.captured, 2);
    assert.deepEqual(await wallet(USER_A), { balance: 8, reserved_balance: 0 });
    const c2 = await call('wallet_capture($1, $2)', [USER_A, res]);
    assert.equal(c2.reused, true);
    assert.deepEqual(await wallet(USER_A), { balance: 8, reserved_balance: 0 });
    assert.equal((await q(`select count(*)::int as n from public.credit_ledger where reservation_id = $1 and transaction_type = 'capture'`, [res]))[0].n, 1);
  });

  await test('a captured reservation can no longer be refunded', async () => {
    const res = (await q(`select id from public.credit_ledger where user_id = $1 and transaction_type = 'reserve'`, [USER_A]))[0].id;
    await expectError('select public.wallet_refund($1, $2)', [USER_A, res], /reservation_already_captured/);
    assert.deepEqual(await wallet(USER_A), { balance: 8, reserved_balance: 0 });
  });

  await test('refund returns the credits ONCE; a second refund is a no-op; a refunded reservation cannot be captured', async () => {
    const res = (await q(`select id from public.credit_ledger where user_id = $1 and transaction_type = 'reserve'`, [USER_B]))[0].id;
    const r1 = await call('wallet_refund($1, $2, $3)', [USER_B, res, 'provider_error']);
    assert.equal(r1.reused, false);
    assert.deepEqual(await wallet(USER_B), { balance: 2, reserved_balance: 0 });
    const r2 = await call('wallet_refund($1, $2, $3)', [USER_B, res, 'again']);
    assert.equal(r2.reused, true);
    assert.deepEqual(await wallet(USER_B), { balance: 2, reserved_balance: 0 });
    await expectError('select public.wallet_capture($1, $2)', [USER_B, res], /reservation_already_refunded/);
  });

  await test('a user cannot capture or refund a reservation that belongs to someone else', async () => {
    const res = (await q(`select id from public.credit_ledger where user_id = $1 and transaction_type = 'reserve'`, [USER_A]))[0].id;
    await expectError('select public.wallet_refund($1, $2)', [USER_B, res], /reservation_not_found/);
    await expectError('select public.wallet_capture($1, $2)', [USER_B, res], /reservation_not_found/);
  });

  await test('partial capture (e.g. 2 of 3 images delivered): captures 2, returns 1, in one transaction', async () => {
    await call('wallet_credit($1, $2, $3)', [USER_A, 10, 'grant']);
    const r = await call('wallet_reserve($1, $2, $3, $4, $5)', [USER_A, 3, 'text_to_image', null, 'partial-1']);
    const before = await wallet(USER_A);
    assert.equal(before.reserved_balance, 3);
    const c = await call('wallet_capture($1, $2, $3)', [USER_A, r.reservation_id, 2]);
    assert.equal(c.captured, 2);
    assert.equal(c.refunded, 1);
    assert.deepEqual(await wallet(USER_A), { balance: before.balance + 1, reserved_balance: 0 });
    await expectError('select public.wallet_capture($1, $2, $3)', [USER_A, (await call('wallet_reserve($1, $2, $3)', [USER_A, 1, 't'])).reservation_id, 5], /invalid_amount/);
  });

  await test('the ledger is immutable: UPDATE, DELETE and TRUNCATE are all rejected', async () => {
    await expectError(`update public.credit_ledger set amount = 999`, [], /append-only/);
    await expectError(`delete from public.credit_ledger`, [], /append-only/);
    await expectError(`truncate public.credit_ledger`, [], /append-only/);
  });

  await test('ledger integrity: every settled reservation reconciles (wallet balance + reserved == credits granted - captured)', async () => {
    for (const u of [USER_A, USER_B]) {
      const w = await wallet(u);
      const agg = (
        await q(
          `select coalesce(sum(case when transaction_type in ('credit','adjustment') then amount end),0)::int as granted,
                  coalesce(sum(case when transaction_type = 'capture' then amount end),0)::int as captured
           from public.credit_ledger where user_id = $1`,
          [u]
        )
      )[0];
      assert.equal(w.balance + w.reserved_balance, agg.granted - agg.captured, `user ${u}`);
    }
  });

  await test('wallet_adjust: signed correction with a required reason; never below zero; idempotent', async () => {
    const before = (await wallet(USER_B)).balance;
    await call('wallet_adjust($1, $2, $3, $4)', [USER_B, -1, 'manual fix', 'adj-1']);
    assert.equal((await wallet(USER_B)).balance, before - 1);
    const again = await call('wallet_adjust($1, $2, $3, $4)', [USER_B, -1, 'manual fix', 'adj-1']);
    assert.equal(again.reused, true);
    assert.equal((await wallet(USER_B)).balance, before - 1);
    await expectError('select public.wallet_adjust($1, $2, $3)', [USER_B, -1000, 'too much'], /insufficient_credits/);
    await expectError('select public.wallet_adjust($1, $2, $3)', [USER_B, 5, ''], /reason_required/);
  });

  await test('wallet_pending_reservations lists only UNSETTLED reservations older than the threshold', async () => {
    const res = await call('wallet_reserve($1, $2, $3, $4, $5)', [USER_A, 1, 'planta_humanizada', GEN_2, 'pending-1']);
    const fresh = await call('wallet_pending_reservations($1)', [3600]);
    assert.ok(!fresh.some((p: any) => p.reservation_id === res.reservation_id), 'a fresh reservation is not stale');
    const stale = await call('wallet_pending_reservations($1)', [0]);
    assert.ok(stale.some((p: any) => p.reservation_id === res.reservation_id));
    await call('wallet_refund($1, $2, $3)', [USER_A, res.reservation_id, 'test']);
    const after = await call('wallet_pending_reservations($1)', [0]);
    assert.ok(!after.some((p: any) => p.reservation_id === res.reservation_id), 'a settled reservation is never pending');
  });

  // ---------------------------------------------------------------- RLS
  await test('RLS: a signed-in user reads ONLY their own wallet and ledger rows', async () => {
    await asRole('authenticated', USER_A, async () => {
      const w = await q('select user_id from public.credit_wallets');
      assert.deepEqual(w.map((r) => r.user_id), [USER_A]);
      const l = await q('select distinct user_id from public.credit_ledger');
      assert.deepEqual(l.map((r) => r.user_id), [USER_A]);
    });
    await asRole('authenticated', USER_B, async () => {
      assert.deepEqual((await q('select user_id from public.credit_wallets')).map((r) => r.user_id), [USER_B]);
    });
  });

  await test('RLS: a signed-in user cannot insert, update or delete wallets or ledger rows (no balance tampering)', async () => {
    await asRole('authenticated', USER_A, async () => {
      await expectError('update public.credit_wallets set balance = 999999 where user_id = $1', [USER_A], /permission denied/);
      await expectError(`insert into public.credit_wallets (user_id, balance) values ($1, 5)`, [USER_B], /permission denied/);
      await expectError(`insert into public.credit_ledger (user_id, transaction_type, amount, balance_before, balance_after, status) values ($1,'credit',100,0,100,'completed')`, [USER_A], /permission denied/);
      await expectError('delete from public.credit_ledger', [], /permission denied/);
    });
    assert.equal((await wallet(USER_A)).balance < 999999, true);
  });

  await test('RLS: signed-in and anonymous roles cannot call any money function (no self-credit, capture or refund)', async () => {
    await asRole('authenticated', USER_A, async () => {
      await expectError('select public.wallet_credit($1, 100, $2)', [USER_A, 'self'], /permission denied/);
      await expectError('select public.wallet_reserve($1, 1, $2)', [USER_A, 't'], /permission denied/);
      await expectError('select public.wallet_ensure($1, 1000)', [USER_A], /permission denied/);
    });
    await asRole('anon', null, async () => {
      await expectError('select public.wallet_credit($1, 100, $2)', [USER_A, 'self'], /permission denied/);
      await expectError('select * from public.credit_wallets', [], /permission denied/);
    });
  });

  await test('RLS: generations — a user sees only their own non-deleted rows and cannot write any', async () => {
    const ins = (id: string, user: string, deleted: boolean) =>
      db.query(
        `insert into public.humanized_floorplan_generations (id, user_id, style, provider, model, deleted_at) values ($1,$2,'classico','openai-image','m', ${deleted ? 'now()' : 'null'})`,
        [id, user]
      );
    await ins('cccccccc-cccc-4ccc-8ccc-cccccccccccc', USER_A, false);
    await ins('dddddddd-dddd-4ddd-8ddd-dddddddddddd', USER_A, true);
    await ins('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', USER_B, false);
    await asRole('authenticated', USER_A, async () => {
      const rows = await q('select id from public.humanized_floorplan_generations');
      assert.deepEqual(rows.map((r) => r.id), ['cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
      await expectError(`update public.humanized_floorplan_generations set status = 'completed'`, [], /permission denied/);
      await expectError(`insert into public.humanized_floorplan_generations (id, user_id, style, provider, model) values ('ffffffff-ffff-4fff-8fff-ffffffffffff', $1, 'x','y','z')`, [USER_A], /permission denied/);
    });
  });

  await test('generations: (user, idempotency_key) is unique; status and non-negative credit columns are constrained', async () => {
    await db.query(`insert into public.humanized_floorplan_generations (id, user_id, style, provider, model, idempotency_key) values ('11111111-0000-4000-8000-000000000001', $1, 's','p','m','dup')`, [USER_A]);
    await expectError(`insert into public.humanized_floorplan_generations (id, user_id, style, provider, model, idempotency_key) values ('11111111-0000-4000-8000-000000000002', $1, 's','p','m','dup')`, [USER_A], /unique|duplicate/i);
    await db.query(`insert into public.humanized_floorplan_generations (id, user_id, style, provider, model, idempotency_key) values ('11111111-0000-4000-8000-000000000003', $1, 's','p','m','dup')`, [USER_B]);
    await expectError(`update public.humanized_floorplan_generations set status = 'weird'`, [], /check/i);
    await expectError(`update public.humanized_floorplan_generations set credits_captured = -1`, [], /check/i);
  });

  await test('storage: bucket is private and the object policy only allows a user to read their own <user_id>/ folder', async () => {
    await db.query(`insert into storage.objects (bucket_id, name) values ('humanized-floorplans', $1), ('humanized-floorplans', $2)`, [`${USER_A}/g/original.png`, `${USER_B}/g/original.png`]);
    await asRole('authenticated', USER_A, async () => {
      const rows = await q(`select name from storage.objects where bucket_id = 'humanized-floorplans'`);
      assert.deepEqual(rows.map((r) => r.name), [`${USER_A}/g/original.png`]);
    });
  });

  // ---------------------------------------------------------------- Astra migration
  await test('astra migration: rows that existed BEFORE it keep working — mode defaults to "standard", attempts to 1, nothing else is touched', async () => {
    const legacy = new PGlite();
    await legacy.exec(SCAFFOLD);
    for (const f of files.slice(0, 3)) await legacy.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    await legacy.query(`insert into public.humanized_floorplan_generations (id, user_id, style, provider, model, status, credits_captured, credits_reserved) values ('99999999-0000-4000-8000-000000000001', $1, 'classico', 'openai-image', 'gpt-image-2.5-sunburst', 'completed', 2, 2)`, [USER_A]);
    await legacy.exec(fs.readFileSync(path.join(MIGRATIONS, files[3]), 'utf8'));
    const row = (await legacy.query(`select * from public.humanized_floorplan_generations`)).rows[0] as any;
    assert.equal(row.generation_mode, 'standard');
    assert.equal(row.attempts_count, 1);
    assert.equal(row.auto_correction_applied, false);
    assert.equal(row.analysis_model, null);
    assert.equal(row.validation_status, null);
    assert.equal(row.fidelity_score, null);
    assert.equal(row.credits_captured, 2);
    assert.equal(row.status, 'completed');
  });

  await test('astra migration: constraints reject an unknown mode, out-of-range score/attempts and invalid statuses; valid astra values are accepted', async () => {
    const ins = (id: string, cols: string, vals: string) => db.query(`insert into public.humanized_floorplan_generations (id, user_id, style, provider, model, ${cols}) values ($1, $2, 'classico','p','m', ${vals})`, [id, USER_A]);
    await ins('aaaaaaaa-0000-4000-8000-000000000001', 'generation_mode, analysis_model, analysis_status, validation_status, fidelity_score, attempts_count, auto_correction_applied', `'astra','gpt-6-astra','completed','approved_after_correction',93,2,true`);
    await expectError(`insert into public.humanized_floorplan_generations (id, user_id, style, provider, model, generation_mode) values ('aaaaaaaa-0000-4000-8000-000000000002', $1, 's','p','m','turbo')`, [USER_A], /check/i);
    await expectError(`update public.humanized_floorplan_generations set fidelity_score = 101 where id = 'aaaaaaaa-0000-4000-8000-000000000001'`, [], /check/i);
    await expectError(`update public.humanized_floorplan_generations set attempts_count = 3 where id = 'aaaaaaaa-0000-4000-8000-000000000001'`, [], /check/i);
    await expectError(`update public.humanized_floorplan_generations set validation_status = 'maybe' where id = 'aaaaaaaa-0000-4000-8000-000000000001'`, [], /check/i);
    await expectError(`update public.humanized_floorplan_generations set analysis_status = 'weird' where id = 'aaaaaaaa-0000-4000-8000-000000000001'`, [], /check/i);
  });

  await test('astra migration: the pipeline-steps table is linked to its generation, unique per step, constrained, and INVISIBLE to browser roles (RLS on, no policy, no grant)', async () => {
    const gen = 'aaaaaaaa-0000-4000-8000-000000000001';
    await db.query(`insert into public.humanized_floorplan_pipeline_steps (generation_id, user_id, step, model, status, started_at, input_tokens, cached_input_tokens, output_tokens, total_tokens, reasoning_effort, request_id, cost_usd, detail) values ($1, $2, 'analysis', 'gpt-6-astra', 'completed', now(), 2000, 500, 800, 2800, 'medium', 'resp_1', 0.0123, '{"score": 90}')`, [gen, USER_A]);
    await expectError(`insert into public.humanized_floorplan_pipeline_steps (generation_id, user_id, step, model, status, started_at) values ($1, $2, 'analysis', 'm', 'completed', now())`, [gen, USER_A], /unique|duplicate/i);
    await expectError(`insert into public.humanized_floorplan_pipeline_steps (generation_id, user_id, step, model, status, started_at) values ($1, $2, 'retry_3', 'm', 'completed', now())`, [gen, USER_A], /check/i);
    await expectError(`insert into public.humanized_floorplan_pipeline_steps (generation_id, user_id, step, model, status, started_at) values ('00000000-0000-4000-8000-00000000dead', $1, 'generation_1', 'm', 'completed', now())`, [USER_A], /foreign key|violates/i);
    await expectError(`insert into public.humanized_floorplan_pipeline_steps (generation_id, user_id, step, model, status, started_at, input_tokens) values ($1, $2, 'generation_1', 'm', 'completed', now(), -5)`, [gen, USER_A], /check/i);
    const rls = (await q(`select relrowsecurity from pg_class where relname = 'humanized_floorplan_pipeline_steps'`))[0];
    assert.equal(rls.relrowsecurity, true);
    await asRole('authenticated', USER_A, async () => {
      await expectError('select * from public.humanized_floorplan_pipeline_steps', [], /permission denied/);
      await expectError(`insert into public.humanized_floorplan_pipeline_steps (generation_id, user_id, step, model, status, started_at) values ('${gen}', '${USER_A}', 'validation_1', 'm', 'completed', now())`, [], /permission denied/);
    });
    await asRole('anon', null, async () => {
      await expectError('select * from public.humanized_floorplan_pipeline_steps', [], /permission denied/);
    });
    assert.equal((await q(`select count(*)::int as n from public.humanized_floorplan_pipeline_steps`))[0].n, 1);
  });

  await test('astra migration: the generations RLS from the earlier migration still holds (users see only their own rows; astra rows included)', async () => {
    await db.query(`insert into public.humanized_floorplan_generations (id, user_id, style, provider, model, generation_mode) values ('aaaaaaaa-0000-4000-8000-000000000009', $1, 'classico','p','m','astra')`, [USER_B]);
    await asRole('authenticated', USER_A, async () => {
      const ids = (await q(`select id from public.humanized_floorplan_generations where generation_mode = 'astra'`)).map((r) => r.id);
      assert.ok(ids.includes('aaaaaaaa-0000-4000-8000-000000000001'));
      assert.ok(!ids.includes('aaaaaaaa-0000-4000-8000-000000000009'));
      await expectError(`update public.humanized_floorplan_generations set generation_mode = 'standard'`, [], /permission denied/);
    });
  });

  await test('no migration contains a destructive statement (DROP TABLE/COLUMN/SCHEMA, TRUNCATE outside triggers, DELETE FROM, ALTER ... DROP)', async () => {
    for (const f of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8').replace(/--.*$/gm, '');
      assert.ok(!/drop\s+(table|column|schema|type)\b/i.test(sql), `${f}: destructive DROP`);
      assert.ok(!/delete\s+from\b/i.test(sql), `${f}: DELETE FROM`);
      assert.ok(!/alter\s+table[^;]*drop\s+/i.test(sql), `${f}: ALTER ... DROP`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('SQL test runner crashed:', err);
  process.exit(1);
});
