-- Blue Render — Arquivos da Obra (project_files)
-- Adds: project_files, plus a private "project-files" Storage bucket.
-- Reuses public.set_updated_at() / public.is_organization_member(org_id) from
-- 20260826120000_auth_foundation.sql and the (id, organization_id) composite-FK
-- "backbone relationship" pattern already used by project_tasks/project_history
-- in 20260826130000_management_foundation.sql — no duplicate helpers/tables.
-- Idempotent: safe to re-run against a database that already has this applied.

create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  -- Nullable + on delete set null (never cascade-delete a file just because the
  -- uploader's account was later removed) — mirrors clients.created_by.
  uploaded_by uuid references auth.users (id) on delete set null default auth.uid(),
  name text not null check (btrim(name) <> '' and char_length(name) <= 200),
  original_name text not null,
  category text not null default 'other'
    check (category in ('project', 'contract', 'financial', 'invoice', 'image', 'client_document', 'survey', 'other')),
  description text check (description is null or char_length(description) <= 1000),
  -- Storage object path inside the private "project-files" bucket
  -- ("<organization_id>/<project_id>/<uuid>-<original_name>"), never a public
  -- URL — the frontend resolves it to a short-lived signed URL on demand.
  storage_path text not null unique,
  mime_type text,
  file_size bigint not null check (file_size > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade
);

create index if not exists idx_project_files_organization_id on public.project_files (organization_id);
create index if not exists idx_project_files_project_id on public.project_files (project_id);
create index if not exists idx_project_files_category on public.project_files (category);
create index if not exists idx_project_files_created_at on public.project_files (created_at);

drop trigger if exists trg_project_files_updated_at on public.project_files;
create trigger trg_project_files_updated_at
  before update on public.project_files
  for each row execute function public.set_updated_at();

alter table public.project_files enable row level security;

-- Any member of the organization can view/upload/edit/delete a file on one of
-- its projects — same breadth as clients/projects' own *_member policies
-- (no admin-only restriction here; day-to-day obra file management is a
-- whole-team activity, not an admin-only one).
drop policy if exists "project_files_select_member" on public.project_files;
create policy "project_files_select_member"
  on public.project_files for select
  using (public.is_organization_member(organization_id));

drop policy if exists "project_files_insert_member" on public.project_files;
create policy "project_files_insert_member"
  on public.project_files for insert
  with check (public.is_organization_member(organization_id) and uploaded_by = auth.uid());

drop policy if exists "project_files_update_member" on public.project_files;
create policy "project_files_update_member"
  on public.project_files for update
  using (public.is_organization_member(organization_id))
  with check (public.is_organization_member(organization_id));

drop policy if exists "project_files_delete_member" on public.project_files;
create policy "project_files_delete_member"
  on public.project_files for delete
  using (public.is_organization_member(organization_id));

-- "Enviado por" needs to show a teammate's name, not just your own —
-- profiles_select_own (auth foundation) only lets a user see their own row.
-- RLS policies for the same command are OR'd together, so this only ADDS a
-- second, narrow way to view a profile (anyone who shares at least one
-- organization with you) — it doesn't loosen insert/update, and doesn't
-- touch profiles_select_own.
drop policy if exists "profiles_select_org_members" on public.profiles;
create policy "profiles_select_org_members"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.organization_members mine
      join public.organization_members theirs on theirs.organization_id = mine.organization_id
      where mine.user_id = auth.uid()
        and theirs.user_id = profiles.id
    )
  );

-- ============================================================================
-- Storage: private bucket for obra files. 50 MB cap and the allowed-format
-- list are enforced by Supabase Storage itself, not just the frontend.
-- allowed_mime_types intentionally includes application/octet-stream: CAD
-- formats (DWG/DXF) have no standardized MIME type and most OSes/browsers
-- report them (and sometimes DOC/XLS too) as octet-stream — the real
-- extension allowlist lives in the frontend's centralized config and is what
-- actually gates which formats are offered/accepted; the bucket's list here
-- is a permissive backstop, not the primary gate. Objects are stored as
-- "<organization_id>/<project_id>/<file>", so folder-scoped RLS below keeps
-- one office's files invisible to every other office (same approach as
-- support-attachments; the project_id segment doesn't need its own check —
-- project_files' composite FK above is what ties a project_id to its real
-- organization_id).
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-files',
  'project-files',
  false,
  52428800,
  array[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/vnd.dwg', 'application/acad', 'application/x-acad', 'image/vnd.dxf', 'application/dxf',
    'application/octet-stream'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "project_files_storage_insert_member" on storage.objects;
create policy "project_files_storage_insert_member"
  on storage.objects for insert
  with check (
    bucket_id = 'project-files'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "project_files_storage_select_member" on storage.objects;
create policy "project_files_storage_select_member"
  on storage.objects for select
  using (
    bucket_id = 'project-files'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "project_files_storage_delete_member" on storage.objects;
create policy "project_files_storage_delete_member"
  on storage.objects for delete
  using (
    bucket_id = 'project-files'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  );

-- Makes the new table visible to PostgREST immediately instead of waiting for
-- its periodic schema-cache refresh (see the same line added retroactively to
-- 20260902130000_support_tickets.sql).
notify pgrst, 'reload schema';
