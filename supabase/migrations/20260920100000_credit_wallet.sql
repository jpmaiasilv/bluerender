-- Blue Render — Credit wallet (one per user) + immutable credit ledger
-- Single source of truth for credits across ALL tools (Render IA, Imagem por
-- Texto, Gerador de Ideias, Vídeo IA, Planta Humanizada...). Replaces the
-- old in-memory global balance in backend/src/services/creditWallet.ts.
--
-- Purely additive and idempotent (safe to re-run). Nothing existing is
-- altered or dropped. All money movement happens ONLY through the
-- SECURITY DEFINER functions below, callable only by the backend's
-- service_role after it has verified the user's access token; no browser
-- role can insert, update, delete, credit, reserve, capture or refund.
--
-- Model: `balance` = spendable credits. reserve() moves credits from
-- `balance` to `reserved_balance` (so two concurrent requests can never
-- both spend the same credits); capture() consumes the reservation;
-- refund() returns it. Every step appends one immutable ledger row.

create table if not exists public.credit_wallets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  reserved_balance integer not null default 0 check (reserved_balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  -- Deliberately NO foreign key to auth.users: financial history must
  -- outlive an account deletion and must never block one.
  user_id uuid not null,
  generation_id uuid,
  -- Set on capture/refund rows: the `reserve` row they settle.
  reservation_id uuid,
  idempotency_key text,
  transaction_type text not null check (transaction_type in ('credit', 'reserve', 'capture', 'refund', 'adjustment')),
  amount integer not null,
  balance_before integer not null check (balance_before >= 0),
  balance_after integer not null check (balance_after >= 0),
  status text not null check (status in ('completed', 'reserved', 'captured', 'refunded')),
  reason text,
  tool text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint credit_ledger_amount_sign check (
    (transaction_type = 'adjustment' and amount <> 0) or (transaction_type <> 'adjustment' and amount > 0)
  ),
  constraint credit_ledger_reservation_link check (
    (transaction_type in ('capture', 'refund')) = (reservation_id is not null)
  )
);

create index if not exists idx_credit_ledger_user_created on public.credit_ledger (user_id, created_at desc);
create index if not exists idx_credit_ledger_generation on public.credit_ledger (generation_id) where generation_id is not null;
create index if not exists idx_credit_ledger_reservation on public.credit_ledger (reservation_id) where reservation_id is not null;

-- Duplicate protection: one row per (user, idempotency key); a reservation
-- can be captured at most once and refunded at most once (a partial capture
-- writes one capture + one refund row for the remainder, in one transaction).
create unique index if not exists uq_credit_ledger_user_idempotency
  on public.credit_ledger (user_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists uq_credit_ledger_one_capture
  on public.credit_ledger (reservation_id) where transaction_type = 'capture';
create unique index if not exists uq_credit_ledger_one_refund
  on public.credit_ledger (reservation_id) where transaction_type = 'refund';

drop trigger if exists trg_credit_wallets_updated_at on public.credit_wallets;
create trigger trg_credit_wallets_updated_at
  before update on public.credit_wallets
  for each row execute function public.set_updated_at();

-- The ledger is append-only: no route (not even the backend's service_role)
-- can edit or delete a movement.
create or replace function public.credit_ledger_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'credit_ledger is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists trg_credit_ledger_no_update on public.credit_ledger;
create trigger trg_credit_ledger_no_update
  before update or delete on public.credit_ledger
  for each row execute function public.credit_ledger_immutable();

drop trigger if exists trg_credit_ledger_no_truncate on public.credit_ledger;
create trigger trg_credit_ledger_no_truncate
  before truncate on public.credit_ledger
  for each statement execute function public.credit_ledger_immutable();

-- ============================================================================
-- RLS: a user may READ only their own wallet and movements. No client role
-- has any write policy.
-- ============================================================================

alter table public.credit_wallets enable row level security;
alter table public.credit_ledger enable row level security;

revoke all on public.credit_wallets from anon, authenticated;
revoke all on public.credit_ledger from anon, authenticated;
grant select on public.credit_wallets to authenticated;
grant select on public.credit_ledger to authenticated;

drop policy if exists credit_wallets_select_own on public.credit_wallets;
create policy credit_wallets_select_own
  on public.credit_wallets for select
  using (user_id = auth.uid());

drop policy if exists credit_ledger_select_own on public.credit_ledger;
create policy credit_ledger_select_own
  on public.credit_ledger for select
  using (user_id = auth.uid());

-- ============================================================================
-- Atomic operations. SECURITY DEFINER with a fixed search_path; executable
-- only by service_role. Each locks the wallet row (FOR UPDATE) before it
-- reads or writes, so concurrent calls on one wallet run one at a time.
-- ============================================================================

-- Creates the wallet if missing and, exactly once per user, grants the
-- signup bonus. Safe to call on every request.
create or replace function public.wallet_ensure(p_user uuid, p_bonus integer default 0)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
  v_balance integer;
begin
  if p_user is null then raise exception 'invalid_user' using errcode = '22023'; end if;
  if p_bonus is null or p_bonus < 0 then raise exception 'invalid_bonus' using errcode = '22023'; end if;

  insert into public.credit_wallets (user_id, balance) values (p_user, 0)
  on conflict (user_id) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 1 and p_bonus > 0 then
    update public.credit_wallets set balance = balance + p_bonus where user_id = p_user;
    insert into public.credit_ledger (user_id, idempotency_key, transaction_type, amount, balance_before, balance_after, status, reason, tool)
    values (p_user, 'signup_bonus:' || p_user::text, 'credit', p_bonus, 0, p_bonus, 'completed', 'signup_bonus', 'system')
    on conflict do nothing;
  end if;

  select balance into v_balance from public.credit_wallets where user_id = p_user;
  return v_balance;
end;
$$;

create or replace function public.wallet_get(p_user uuid)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select jsonb_build_object('balance', balance, 'reserved_balance', reserved_balance) from public.credit_wallets where user_id = p_user),
    jsonb_build_object('balance', null, 'reserved_balance', null)
  );
$$;

create or replace function public.wallet_reserve(
  p_user uuid,
  p_amount integer,
  p_tool text,
  p_generation uuid default null,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w public.credit_wallets%rowtype;
  existing public.credit_ledger%rowtype;
  v_id uuid := gen_random_uuid();
begin
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount' using errcode = '22023'; end if;

  select * into w from public.credit_wallets where user_id = p_user for update;
  if not found then raise exception 'wallet_not_found' using errcode = 'P0002'; end if;

  if p_idempotency_key is not null then
    select * into existing from public.credit_ledger
      where user_id = p_user and idempotency_key = p_idempotency_key and transaction_type = 'reserve';
    if found then
      return jsonb_build_object('reservation_id', existing.id, 'amount', existing.amount, 'balance_after', w.balance, 'reused', true);
    end if;
  end if;

  if w.balance < p_amount then
    raise exception 'insufficient_credits' using errcode = 'P0001', detail = format('balance=%s required=%s', w.balance, p_amount);
  end if;

  update public.credit_wallets
    set balance = balance - p_amount, reserved_balance = reserved_balance + p_amount
    where user_id = p_user;

  insert into public.credit_ledger (id, user_id, generation_id, idempotency_key, transaction_type, amount, balance_before, balance_after, status, reason, tool, metadata)
  values (v_id, p_user, p_generation, p_idempotency_key, 'reserve', p_amount, w.balance, w.balance - p_amount, 'reserved', 'generation', p_tool, coalesce(p_metadata, '{}'::jsonb));

  return jsonb_build_object('reservation_id', v_id, 'amount', p_amount, 'balance_after', w.balance - p_amount, 'reused', false);
end;
$$;

-- Consumes a reservation. p_amount (optional) captures only part of it and
-- returns the remainder to the balance in the same transaction.
create or replace function public.wallet_capture(p_user uuid, p_reservation uuid, p_amount integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w public.credit_wallets%rowtype;
  r public.credit_ledger%rowtype;
  cap public.credit_ledger%rowtype;
  v_capture integer;
  v_remainder integer;
  v_cap_id uuid := gen_random_uuid();
  v_ref_id uuid := gen_random_uuid();
begin
  select * into w from public.credit_wallets where user_id = p_user for update;
  if not found then raise exception 'wallet_not_found' using errcode = 'P0002'; end if;

  select * into r from public.credit_ledger where id = p_reservation and user_id = p_user and transaction_type = 'reserve';
  if not found then raise exception 'reservation_not_found' using errcode = 'P0002'; end if;

  select * into cap from public.credit_ledger where reservation_id = p_reservation and transaction_type = 'capture';
  if found then
    return jsonb_build_object('captured', cap.amount, 'capture_id', cap.id, 'balance_after', w.balance, 'reused', true);
  end if;
  if exists (select 1 from public.credit_ledger where reservation_id = p_reservation and transaction_type = 'refund') then
    raise exception 'reservation_already_refunded' using errcode = 'P0001';
  end if;

  v_capture := coalesce(p_amount, r.amount);
  if v_capture < 1 or v_capture > r.amount then raise exception 'invalid_amount' using errcode = '22023'; end if;
  v_remainder := r.amount - v_capture;
  if w.reserved_balance < r.amount then raise exception 'reserved_balance_mismatch' using errcode = 'P0001'; end if;

  update public.credit_wallets
    set reserved_balance = reserved_balance - r.amount, balance = balance + v_remainder
    where user_id = p_user;

  insert into public.credit_ledger (id, user_id, generation_id, reservation_id, transaction_type, amount, balance_before, balance_after, status, reason, tool)
  values (v_cap_id, p_user, r.generation_id, p_reservation, 'capture', v_capture, w.balance, w.balance, 'captured', 'generation_completed', r.tool);

  if v_remainder > 0 then
    insert into public.credit_ledger (id, user_id, generation_id, reservation_id, transaction_type, amount, balance_before, balance_after, status, reason, tool)
    values (v_ref_id, p_user, r.generation_id, p_reservation, 'refund', v_remainder, w.balance, w.balance + v_remainder, 'refunded', 'partial_capture_remainder', r.tool);
  end if;

  return jsonb_build_object('captured', v_capture, 'capture_id', v_cap_id, 'refunded', v_remainder, 'refund_id', case when v_remainder > 0 then v_ref_id end, 'balance_after', w.balance + v_remainder, 'reused', false);
end;
$$;

create or replace function public.wallet_refund(p_user uuid, p_reservation uuid, p_reason text default 'generation_failed')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w public.credit_wallets%rowtype;
  r public.credit_ledger%rowtype;
  rf public.credit_ledger%rowtype;
  v_ref_id uuid := gen_random_uuid();
begin
  select * into w from public.credit_wallets where user_id = p_user for update;
  if not found then raise exception 'wallet_not_found' using errcode = 'P0002'; end if;

  select * into r from public.credit_ledger where id = p_reservation and user_id = p_user and transaction_type = 'reserve';
  if not found then raise exception 'reservation_not_found' using errcode = 'P0002'; end if;

  if exists (select 1 from public.credit_ledger where reservation_id = p_reservation and transaction_type = 'capture') then
    raise exception 'reservation_already_captured' using errcode = 'P0001';
  end if;
  select * into rf from public.credit_ledger where reservation_id = p_reservation and transaction_type = 'refund';
  if found then
    return jsonb_build_object('refunded', rf.amount, 'refund_id', rf.id, 'balance_after', w.balance, 'reused', true);
  end if;

  if w.reserved_balance < r.amount then raise exception 'reserved_balance_mismatch' using errcode = 'P0001'; end if;

  update public.credit_wallets
    set reserved_balance = reserved_balance - r.amount, balance = balance + r.amount
    where user_id = p_user;

  insert into public.credit_ledger (id, user_id, generation_id, reservation_id, transaction_type, amount, balance_before, balance_after, status, reason, tool)
  values (v_ref_id, p_user, r.generation_id, p_reservation, 'refund', r.amount, w.balance, w.balance + r.amount, 'refunded', coalesce(nullif(btrim(p_reason), ''), 'generation_failed'), r.tool);

  return jsonb_build_object('refunded', r.amount, 'refund_id', v_ref_id, 'balance_after', w.balance + r.amount, 'reused', false);
end;
$$;

-- Grants credits (purchases, plan renewals, promotions, dev test credits).
create or replace function public.wallet_credit(
  p_user uuid,
  p_amount integer,
  p_reason text,
  p_tool text default 'system',
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w public.credit_wallets%rowtype;
  existing public.credit_ledger%rowtype;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount' using errcode = '22023'; end if;
  select * into w from public.credit_wallets where user_id = p_user for update;
  if not found then raise exception 'wallet_not_found' using errcode = 'P0002'; end if;

  if p_idempotency_key is not null then
    select * into existing from public.credit_ledger where user_id = p_user and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('balance_after', w.balance, 'reused', true);
    end if;
  end if;

  update public.credit_wallets set balance = balance + p_amount where user_id = p_user;
  insert into public.credit_ledger (user_id, idempotency_key, transaction_type, amount, balance_before, balance_after, status, reason, tool, metadata)
  values (p_user, p_idempotency_key, 'credit', p_amount, w.balance, w.balance + p_amount, 'completed', p_reason, p_tool, coalesce(p_metadata, '{}'::jsonb));
  return jsonb_build_object('balance_after', w.balance + p_amount, 'reused', false);
end;
$$;

-- Signed manual correction (administration). Never lets the balance go negative.
create or replace function public.wallet_adjust(p_user uuid, p_delta integer, p_reason text, p_idempotency_key text default null, p_metadata jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w public.credit_wallets%rowtype;
  existing public.credit_ledger%rowtype;
begin
  if p_delta is null or p_delta = 0 then raise exception 'invalid_amount' using errcode = '22023'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'reason_required' using errcode = '22023'; end if;
  select * into w from public.credit_wallets where user_id = p_user for update;
  if not found then raise exception 'wallet_not_found' using errcode = 'P0002'; end if;

  if p_idempotency_key is not null then
    select * into existing from public.credit_ledger where user_id = p_user and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('balance_after', w.balance, 'reused', true);
    end if;
  end if;
  if w.balance + p_delta < 0 then raise exception 'insufficient_credits' using errcode = 'P0001'; end if;

  update public.credit_wallets set balance = balance + p_delta where user_id = p_user;
  insert into public.credit_ledger (user_id, idempotency_key, transaction_type, amount, balance_before, balance_after, status, reason, tool, metadata)
  values (p_user, p_idempotency_key, 'adjustment', p_delta, w.balance, w.balance + p_delta, 'completed', p_reason, 'admin', coalesce(p_metadata, '{}'::jsonb));
  return jsonb_build_object('balance_after', w.balance + p_delta, 'reused', false);
end;
$$;

-- Reservations neither captured nor refunded after p_older_than_seconds —
-- input for the backend's reconciliation (see services/walletReconciler.ts).
create or replace function public.wallet_pending_reservations(p_older_than_seconds integer, p_user uuid default null)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'reservation_id', r.id, 'user_id', r.user_id, 'generation_id', r.generation_id,
    'amount', r.amount, 'tool', r.tool, 'created_at', r.created_at
  ) order by r.created_at), '[]'::jsonb)
  from public.credit_ledger r
  where r.transaction_type = 'reserve'
    and r.created_at < now() - make_interval(secs => greatest(p_older_than_seconds, 0))
    and (p_user is null or r.user_id = p_user)
    and not exists (select 1 from public.credit_ledger s where s.reservation_id = r.id);
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'wallet_ensure(uuid, integer)',
    'wallet_get(uuid)',
    'wallet_reserve(uuid, integer, text, uuid, text, jsonb)',
    'wallet_capture(uuid, uuid, integer)',
    'wallet_refund(uuid, uuid, text)',
    'wallet_credit(uuid, integer, text, text, text, jsonb)',
    'wallet_adjust(uuid, integer, text, text, jsonb)',
    'wallet_pending_reservations(integer, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end
$$;

notify pgrst, 'reload schema';
