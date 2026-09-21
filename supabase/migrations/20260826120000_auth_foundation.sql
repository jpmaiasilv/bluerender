-- Blue Render — Auth Foundation
-- profiles + organizations ("Escritórios") + organization_members, with RLS
-- enabled from creation (no table is ever left open). Idempotent: safe to
-- re-run against a database that already has some/all of this applied.
--
-- Scope: auth.users -> profiles -> organization_members -> organizations.
-- Does NOT touch financial_transactions, projects, credits/subscriptions —
-- those stay on IndexedDB and are migrated in a later, separate step.

create extension if not exists pgcrypto;

-- ============================================================================
-- Tables
-- ============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  owner_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists idx_organization_members_user_id on public.organization_members (user_id);
create index if not exists idx_organization_members_organization_id on public.organization_members (organization_id);
create index if not exists idx_organizations_owner_id on public.organizations (owner_id);

-- ============================================================================
-- updated_at maintenance (reused by profiles + organizations)
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_organizations_updated_at on public.organizations;
create trigger trg_organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Auto-create a profile row whenever a new auth.users row appears.
-- SECURITY DEFINER + fixed search_path so it can't be hijacked by a
-- search_path change, and so it can write past RLS (there is no INSERT
-- policy for profiles — this trigger is the only way a row is created).
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      ''
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- RLS helper functions. Each takes only an organization id — never a
-- user id — so a caller can only ever ask "am I a member/admin/owner of
-- org X", never inspect another user's membership. SECURITY DEFINER lets
-- them read organization_members without recursively re-triggering that
-- table's own RLS policies (which are themselves built on these functions).
-- ============================================================================

create or replace function public.is_organization_member(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_organization_admin(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  );
$$;

create or replace function public.is_organization_owner(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org_id and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- ============================================================================
-- ensure_default_organization(): the only way a "Meu escritório" gets
-- created for a user. Idempotent — an advisory lock scoped to the calling
-- user serializes concurrent calls (double-fired onAuthStateChange, a
-- callback that runs twice, etc.) so two organizations can never be created
-- for the same user even under a race.
-- ============================================================================

create or replace function public.ensure_default_organization()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  perform pg_advisory_xact_lock(hashtext('ensure_default_organization:' || v_user_id::text));

  select organization_id into v_org_id
  from public.organization_members
  where user_id = v_user_id
  order by created_at asc
  limit 1;

  if v_org_id is not null then
    return v_org_id;
  end if;

  insert into public.organizations (name, owner_id)
  values ('Meu escritório', v_user_id)
  returning id into v_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org_id, v_user_id, 'owner')
  on conflict (organization_id, user_id) do nothing;

  return v_org_id;
end;
$$;

-- ============================================================================
-- create_organization(name): prepared for a future multi-org UI. Not called
-- from the frontend yet.
-- ============================================================================

create or replace function public.create_organization(org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_clean_name text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  v_clean_name := nullif(btrim(org_name), '');
  if v_clean_name is null then
    raise exception 'Organization name is required';
  end if;

  insert into public.organizations (name, owner_id)
  values (v_clean_name, v_user_id)
  returning id into v_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org_id, v_user_id, 'owner');

  return v_org_id;
end;
$$;

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

-- profiles: a user can see and edit only their own row. Insert happens only
-- via the SECURITY DEFINER trigger above, so no INSERT policy is needed.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- organizations: visible only to members; owner/admin can rename; only the
-- owner can delete; creation only through ensure_default_organization /
-- create_organization (both SECURITY DEFINER, so no INSERT policy exists).
drop policy if exists "organizations_select_member" on public.organizations;
create policy "organizations_select_member"
  on public.organizations for select
  using (public.is_organization_member(id));

drop policy if exists "organizations_update_admin" on public.organizations;
create policy "organizations_update_admin"
  on public.organizations for update
  using (public.is_organization_admin(id))
  with check (public.is_organization_admin(id));

drop policy if exists "organizations_delete_owner" on public.organizations;
create policy "organizations_delete_owner"
  on public.organizations for delete
  using (public.is_organization_owner(id));

-- organization_members: visible to fellow members of the same org. Insert
-- and update/delete are restricted to admins/owner and can never grant or
-- target the 'owner' role — nobody can self-promote or self-add as owner
-- of an org they don't already own. Not exposed in the UI yet; prepared for
-- a future team-management screen.
drop policy if exists "organization_members_select_member" on public.organization_members;
create policy "organization_members_select_member"
  on public.organization_members for select
  using (public.is_organization_member(organization_id));

drop policy if exists "organization_members_insert_admin" on public.organization_members;
create policy "organization_members_insert_admin"
  on public.organization_members for insert
  with check (public.is_organization_admin(organization_id) and role <> 'owner');

drop policy if exists "organization_members_update_admin" on public.organization_members;
create policy "organization_members_update_admin"
  on public.organization_members for update
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id) and role <> 'owner');

drop policy if exists "organization_members_delete_admin" on public.organization_members;
create policy "organization_members_delete_admin"
  on public.organization_members for delete
  using (public.is_organization_admin(organization_id) and role <> 'owner');
