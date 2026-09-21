-- Blue Render — Support Tickets (Central de Ajuda)
-- Adds: support_tickets, plus a private "support-attachments" Storage bucket.
-- Reuses public.set_updated_at() and public.is_organization_member(org_id)
-- from 20260826120000_auth_foundation.sql — no duplicate helpers/tables.
-- Idempotent: safe to re-run against a database that already has this applied.

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Always the caller's own id — never accepted as client input (see RLS
  -- insert check below), mirrors clients.created_by's `default auth.uid()`.
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  category text not null check (category in ('question', 'technical', 'financial', 'suggestion', 'other')),
  subject text not null check (btrim(subject) <> '' and char_length(subject) <= 200),
  message text not null check (btrim(message) <> '' and char_length(message) <= 5000),
  status text not null default 'submitted' check (status in ('submitted', 'in_review', 'answered', 'resolved')),
  -- Storage object path inside the private "support-attachments" bucket
  -- (e.g. "<organization_id>/<uuid>-<filename>"), never a public URL — the
  -- frontend resolves it to a short-lived signed URL when displaying.
  attachment_url text,
  admin_response text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_support_tickets_organization_id on public.support_tickets (organization_id);
create index if not exists idx_support_tickets_user_id on public.support_tickets (user_id);

drop trigger if exists trg_support_tickets_updated_at on public.support_tickets;
create trigger trg_support_tickets_updated_at
  before update on public.support_tickets
  for each row execute function public.set_updated_at();

alter table public.support_tickets enable row level security;

-- Members can create and view their organization's tickets. No update/delete
-- policy for any client role: admin_response/status are set later (support
-- staff via SQL/dashboard, or a future admin panel) — never from the app.
drop policy if exists "support_tickets_select_member" on public.support_tickets;
create policy "support_tickets_select_member"
  on public.support_tickets for select
  using (public.is_organization_member(organization_id));

drop policy if exists "support_tickets_insert_member" on public.support_tickets;
create policy "support_tickets_insert_member"
  on public.support_tickets for insert
  with check (public.is_organization_member(organization_id) and user_id = auth.uid());

-- ============================================================================
-- Storage: private bucket for ticket attachments (PNG/JPG/JPEG/WEBP, 8 MB cap
-- enforced by Supabase Storage itself — not just the frontend). Objects are
-- stored as "<organization_id>/<file>", so folder-scoped RLS below is enough
-- to keep one office's attachments invisible to every other office.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-attachments', 'support-attachments', false, 8388608, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "support_attachments_insert_member" on storage.objects;
create policy "support_attachments_insert_member"
  on storage.objects for insert
  with check (
    bucket_id = 'support-attachments'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "support_attachments_select_member" on storage.objects;
create policy "support_attachments_select_member"
  on storage.objects for select
  using (
    bucket_id = 'support-attachments'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
  );

-- Makes the new table visible to PostgREST immediately instead of waiting for
-- its periodic schema-cache refresh.
notify pgrst, 'reload schema';
