-- Blue Render — Planta Humanizada generations
-- Adds: humanized_floorplan_generations.
-- Revised 2026-09-20 BEFORE ever being applied (confirmed against the live
-- database: the table did not exist): the credit ledger that used to live
-- here moved to the shared wallet (20260920100000_credit_wallet.sql, table
-- credit_ledger), and this table now only references it by id.
--
-- Purely additive and idempotent (safe to re-run); nothing existing is
-- altered or dropped. Written ONLY by the backend (service_role bypasses
-- RLS) after it has verified the user's Supabase access token — the browser
-- never inserts, updates or deletes these rows and never supplies user_id,
-- status, cost or credits. Files live in the private Storage bucket
-- "humanized-floorplans"; this table stores their object paths, never URLs.

create table if not exists public.humanized_floorplan_generations (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  idempotency_key text,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  original_file_name text check (original_file_name is null or char_length(original_file_name) <= 200),
  reference_file_name text check (reference_file_name is null or char_length(reference_file_name) <= 200),
  has_reference boolean not null default false,
  source_generation_id uuid,
  style text not null,
  lighting text not null default 'clear_day',
  surroundings text not null default 'auto',
  surroundings_kind text,
  custom_surroundings text check (custom_surroundings is null or char_length(custom_surroundings) <= 200),
  text_mode text not null default 'auto',
  furniture_level text not null default 'auto',
  output_format text not null default 'original',
  custom_instructions text check (custom_instructions is null or char_length(custom_instructions) <= 2000),
  -- Credits: the ledger (credit_ledger) is the source of truth; these are a
  -- denormalized per-generation summary plus the movement ids.
  credits_reserved integer not null default 0 check (credits_reserved >= 0),
  credits_captured integer not null default 0 check (credits_captured >= 0),
  credits_refunded integer not null default 0 check (credits_refunded >= 0),
  reservation_id uuid,
  capture_transaction_id uuid,
  refund_transaction_id uuid,
  provider text not null,
  model text not null,
  quality text,
  size text,
  request_id text,
  usage jsonb,
  cost_usd numeric(12, 6),
  error_code text,
  error_message text check (error_message is null or char_length(error_message) <= 500),
  original_path text,
  reference_path text,
  result_path text,
  result_jpg_path text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz
);

create unique index if not exists uq_humanized_generations_user_idempotency
  on public.humanized_floorplan_generations (user_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists idx_humanized_generations_user_created
  on public.humanized_floorplan_generations (user_id, created_at desc)
  where deleted_at is null;
create index if not exists idx_humanized_generations_processing
  on public.humanized_floorplan_generations (created_at)
  where status = 'processing';

alter table public.humanized_floorplan_generations enable row level security;

revoke all on public.humanized_floorplan_generations from anon, authenticated;
grant select on public.humanized_floorplan_generations to authenticated;

-- Users may only READ their own, non-deleted rows. No insert/update/delete
-- policy exists for any client role: the backend service_role is the only writer.
drop policy if exists humanized_generations_select_own on public.humanized_floorplan_generations;
create policy humanized_generations_select_own
  on public.humanized_floorplan_generations for select
  using (user_id = auth.uid() and deleted_at is null);

notify pgrst, 'reload schema';
