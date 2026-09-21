-- Blue Render — Planta Humanizada: second generation mode ("astra")
-- Complements 20260919120000_humanized_floorplan_generations.sql (not edited).
-- Purely additive and idempotent: only ADDs columns/constraints/indexes and one
-- new table; every existing row keeps working (generation_mode defaults to
-- 'standard', attempts_count to 1, everything else NULL / false) and no data,
-- column or policy is removed or rewritten.

alter table public.humanized_floorplan_generations
  add column if not exists generation_mode text not null default 'standard',
  add column if not exists analysis_model text,
  add column if not exists analysis_status text,
  add column if not exists validation_status text,
  add column if not exists fidelity_score integer,
  add column if not exists attempts_count integer not null default 1,
  add column if not exists auto_correction_applied boolean not null default false,
  add column if not exists violations_summary jsonb,
  add column if not exists pipeline_stage text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_humanized_generations_mode') then
    alter table public.humanized_floorplan_generations
      add constraint chk_humanized_generations_mode check (generation_mode in ('standard', 'astra'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_humanized_generations_analysis_status') then
    alter table public.humanized_floorplan_generations
      add constraint chk_humanized_generations_analysis_status check (analysis_status is null or analysis_status in ('completed', 'failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_humanized_generations_validation_status') then
    alter table public.humanized_floorplan_generations
      add constraint chk_humanized_generations_validation_status
      check (validation_status is null or validation_status in ('approved', 'approved_after_correction', 'delivered_minor_deviations', 'failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_humanized_generations_fidelity_score') then
    alter table public.humanized_floorplan_generations
      add constraint chk_humanized_generations_fidelity_score check (fidelity_score is null or (fidelity_score >= 0 and fidelity_score <= 100));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_humanized_generations_attempts') then
    alter table public.humanized_floorplan_generations
      add constraint chk_humanized_generations_attempts check (attempts_count between 1 and 2);
  end if;
end
$$;

create index if not exists idx_humanized_generations_mode
  on public.humanized_floorplan_generations (user_id, generation_mode)
  where deleted_at is null;

-- One row per pipeline step (analysis, generation, validation, correction...).
-- Internal accounting: written and read ONLY by the backend (service_role).
-- RLS is on with no policy and no client grant, so no browser role can see it.
create table if not exists public.humanized_floorplan_pipeline_steps (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.humanized_floorplan_generations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  step text not null check (step in ('analysis', 'generation_1', 'validation_1', 'generation_2', 'validation_2')),
  model text not null,
  status text not null check (status in ('completed', 'failed')),
  started_at timestamptz not null,
  completed_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  cached_input_tokens integer check (cached_input_tokens is null or cached_input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  reasoning_effort text,
  request_id text,
  cost_usd numeric(12, 6),
  -- Sanitized, bounded summary (e.g. score, violation count) — never a raw provider response, prompt or image.
  detail jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  unique (generation_id, step)
);

create index if not exists idx_humanized_pipeline_steps_generation on public.humanized_floorplan_pipeline_steps (generation_id);
create index if not exists idx_humanized_pipeline_steps_user on public.humanized_floorplan_pipeline_steps (user_id, created_at desc);

alter table public.humanized_floorplan_pipeline_steps enable row level security;
revoke all on public.humanized_floorplan_pipeline_steps from anon, authenticated;

notify pgrst, 'reload schema';
