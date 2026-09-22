-- Blue Render — Upscale IA (Topaz Labs "High Fidelity V2")
-- Adds: upscale_jobs table + the "upscale-images" private Storage bucket.
--
-- Same security shape as humanized_floorplan_generations /
-- humanized-floorplans (20260919120000 / 20260920110000): written ONLY by
-- the backend (service_role bypasses RLS) after it has verified the user's
-- Supabase access token. The browser never inserts, updates or deletes rows
-- and never supplies user_id, status or credit fields. Files live in the
-- private bucket; this table stores their object paths, never public URLs.

create table if not exists public.upscale_jobs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  idempotency_key text,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled', 'timed_out')),
  provider text not null default 'topaz',
  provider_process_id text,
  model text not null,
  scale integer not null check (scale in (2, 4)),
  original_width integer not null check (original_width > 0),
  original_height integer not null check (original_height > 0),
  output_width integer check (output_width is null or output_width > 0),
  output_height integer check (output_height is null or output_height > 0),
  original_path text,
  result_path text,
  credits_reserved integer not null default 0 check (credits_reserved >= 0),
  credits_captured integer not null default 0 check (credits_captured >= 0),
  credits_refunded integer not null default 0 check (credits_refunded >= 0),
  reservation_id uuid,
  capture_transaction_id uuid,
  refund_transaction_id uuid,
  error_code text,
  error_message text check (error_message is null or char_length(error_message) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz
);

create unique index if not exists uq_upscale_jobs_user_idempotency
  on public.upscale_jobs (user_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists idx_upscale_jobs_user_created
  on public.upscale_jobs (user_id, created_at desc)
  where deleted_at is null;
create index if not exists idx_upscale_jobs_processing
  on public.upscale_jobs (created_at)
  where status in ('queued', 'processing');

alter table public.upscale_jobs enable row level security;

revoke all on public.upscale_jobs from anon, authenticated;
grant select on public.upscale_jobs to authenticated;

-- Users may only READ their own, non-deleted rows. No insert/update/delete
-- policy exists for any client role: the backend service_role is the only writer.
drop policy if exists upscale_jobs_select_own on public.upscale_jobs;
create policy upscale_jobs_select_own
  on public.upscale_jobs for select
  using (user_id = auth.uid() and deleted_at is null);

-- Private Storage bucket for the original + upscaled files. Objects live at
-- "<user_id>/<job_id>/original.<ext>" and "<user_id>/<job_id>/result.<ext>".
-- Nothing is reachable by a public URL; the backend hands the browser
-- short-lived signed URLs after an ownership check.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'upscale-images',
  'upscale-images',
  false,
  524288000, -- 500MB, matches Topaz's own request size cap
  array['image/png', 'image/jpeg']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "upscale_images_storage_select_own" on storage.objects;
create policy "upscale_images_storage_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'upscale-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

notify pgrst, 'reload schema';
