-- Blue Render — Management Foundation (Clientes, Fluxo de Projetos, Financeiro)
-- Adds: clients, project_stages, projects, project_tasks, project_tags,
-- project_tag_links, project_history, financial_categories,
-- financial_recurrences, financial_transactions — all organization-scoped,
-- all RLS-enabled from creation. Idempotent: safe to re-run.
--
-- Does NOT modify the already-applied auth_foundation migration in any way.
-- Does NOT touch wallet/credits, plans/Stripe, AI tool history, or Storage —
-- those are out of scope for this step.

-- ============================================================================
-- Tables
-- ============================================================================

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  company text,
  email text,
  phone text,
  address text,
  notes text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index if not exists idx_clients_organization_id on public.clients (organization_id);

create table if not exists public.project_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index if not exists idx_project_stages_organization_id on public.project_stages (organization_id);
create index if not exists idx_project_stages_position on public.project_stages (organization_id, position);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  stage_id uuid not null,

  name text not null check (btrim(name) <> ''),
  project_type text,
  contract_value_cents bigint not null default 0 check (contract_value_cents >= 0),

  position integer not null default 0,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),

  start_date date,
  due_date date,

  waiting_for_client boolean not null default false,
  waiting_since date,

  approval_status text not null default 'none' check (approval_status in ('none', 'awaitingApproval', 'changesRequested', 'approved')),

  responsible_user_id uuid references auth.users (id) on delete set null,
  responsible_name text,

  next_action text,
  notes text,

  stage_entered_at timestamptz not null default now(),
  archived_at timestamptz,
  completed_at timestamptz,

  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, organization_id),
  foreign key (stage_id, organization_id) references public.project_stages (id, organization_id) on delete restrict
);
create index if not exists idx_projects_organization_id on public.projects (organization_id);
create index if not exists idx_projects_stage_id on public.projects (stage_id);
create index if not exists idx_projects_due_date on public.projects (due_date);
create index if not exists idx_projects_priority on public.projects (priority);
create index if not exists idx_projects_client_id on public.projects (client_id);
create index if not exists idx_projects_archived_at on public.projects (archived_at);

create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null,

  title text not null check (btrim(title) <> ''),
  completed boolean not null default false,
  position integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade
);
create index if not exists idx_project_tasks_project_id on public.project_tasks (project_id);

create table if not exists public.project_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index if not exists idx_project_tags_organization_id on public.project_tags (organization_id);

create table if not exists public.project_tag_links (
  project_id uuid not null,
  tag_id uuid not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, tag_id),
  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade,
  foreign key (tag_id, organization_id) references public.project_tags (id, organization_id) on delete cascade
);
create index if not exists idx_project_tag_links_tag_id on public.project_tag_links (tag_id);

create table if not exists public.project_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null,

  event_type text not null default 'stage_change',
  -- Intentionally NOT a foreign key: a history entry must remain a valid,
  -- readable audit record even after the stage it names is later deleted
  -- (stages can be deleted once empty — see project_stages RLS/business
  -- rule). Enforcing referential integrity here would block legitimate
  -- stage deletions.
  from_stage_id uuid,
  to_stage_id uuid,
  metadata jsonb,

  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),

  foreign key (project_id, organization_id) references public.projects (id, organization_id) on delete cascade
);
create index if not exists idx_project_history_project_id on public.project_history (project_id);
create index if not exists idx_project_history_created_at on public.project_history (created_at);

create table if not exists public.financial_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  type text not null check (type in ('income', 'expense')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index if not exists idx_financial_categories_organization_id on public.financial_categories (organization_id);
create index if not exists idx_financial_categories_type on public.financial_categories (type);

-- Mirrors the real, already-shipped RecurrenceRule type exactly (frequency +
-- interval + start/end date only) — NOT the richer conceptual sketch in the
-- request. In the current app, type/description/amount/category/project/
-- client all live on each individual FinancialTransaction occurrence (linked
-- back here via recurrence_id); the rule itself is only ever the pattern.
-- Duplicating those fields onto the rule too would diverge from the
-- existing, working repository interface for no behavioral gain. There is
-- also no "active" toggle today — a rule is just the record of the pattern
-- used when its (bounded) occurrences were generated; see recurrence.ts's
-- MAX_GENERATED_OCCURRENCES=12 policy, preserved as-is.
create table if not exists public.financial_recurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  frequency text not null check (frequency in ('weekly', 'monthly', 'yearly')),
  recurrence_interval integer not null default 1 check (recurrence_interval >= 1),
  start_date date not null,
  end_date date,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index if not exists idx_financial_recurrences_organization_id on public.financial_recurrences (organization_id);

create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  type text not null check (type in ('income', 'expense')),
  description text not null check (btrim(description) <> ''),
  amount_cents bigint not null check (amount_cents > 0),
  category_id uuid not null,

  transaction_date date not null,
  due_date date,
  settled_date date,
  settled boolean not null default false,

  -- Nullable, plain (non-composite) FKs + the validate_financial_transaction_org
  -- trigger below: a composite (id, organization_id) FK can't combine with
  -- ON DELETE SET NULL here, because that action would try to null out
  -- organization_id too (part of the composite key), which is NOT NULL and
  -- must never be cleared. The trigger gives the same cross-tenant
  -- guarantee without that conflict.
  project_id uuid references public.projects (id) on delete set null,
  client_id uuid references public.clients (id) on delete set null,
  recurrence_id uuid references public.financial_recurrences (id) on delete set null,

  payment_method text check (payment_method in ('pix', 'bankTransfer', 'creditCard', 'debitCard', 'boleto', 'cash', 'other')),
  payment_method_note text,
  notes text,

  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (category_id, organization_id) references public.financial_categories (id, organization_id) on delete restrict
);
create index if not exists idx_financial_transactions_organization_id on public.financial_transactions (organization_id);
create index if not exists idx_financial_transactions_transaction_date on public.financial_transactions (transaction_date);
create index if not exists idx_financial_transactions_due_date on public.financial_transactions (due_date);
create index if not exists idx_financial_transactions_type on public.financial_transactions (type);
create index if not exists idx_financial_transactions_settled on public.financial_transactions (settled);
create index if not exists idx_financial_transactions_project_id on public.financial_transactions (project_id);
create index if not exists idx_financial_transactions_client_id on public.financial_transactions (client_id);
create index if not exists idx_financial_transactions_category_id on public.financial_transactions (category_id);
create index if not exists idx_financial_transactions_recurrence_id on public.financial_transactions (recurrence_id);

-- ============================================================================
-- updated_at (reuses set_updated_at() from the auth_foundation migration —
-- not redefined here)
-- ============================================================================

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at before update on public.clients for each row execute function public.set_updated_at();

drop trigger if exists trg_project_stages_updated_at on public.project_stages;
create trigger trg_project_stages_updated_at before update on public.project_stages for each row execute function public.set_updated_at();

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at before update on public.projects for each row execute function public.set_updated_at();

drop trigger if exists trg_project_tasks_updated_at on public.project_tasks;
create trigger trg_project_tasks_updated_at before update on public.project_tasks for each row execute function public.set_updated_at();

drop trigger if exists trg_financial_categories_updated_at on public.financial_categories;
create trigger trg_financial_categories_updated_at before update on public.financial_categories for each row execute function public.set_updated_at();

drop trigger if exists trg_financial_transactions_updated_at on public.financial_transactions;
create trigger trg_financial_transactions_updated_at before update on public.financial_transactions for each row execute function public.set_updated_at();

-- ============================================================================
-- Multi-tenant integrity for the nullable cross-links that couldn't use a
-- composite FK (see comments above). Blocks e.g. a financial_transaction in
-- organization A from ever pointing at a project belonging to organization B
-- — this is enforced in the database, not just in the UI.
-- ============================================================================

create or replace function public.validate_project_org()
returns trigger
language plpgsql
as $$
begin
  if new.client_id is not null then
    if not exists (select 1 from public.clients c where c.id = new.client_id and c.organization_id = new.organization_id) then
      raise exception 'client_id must belong to the same organization as the project';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_projects_validate_org on public.projects;
create trigger trg_projects_validate_org
  before insert or update on public.projects
  for each row execute function public.validate_project_org();

create or replace function public.validate_financial_transaction_org()
returns trigger
language plpgsql
as $$
begin
  if new.project_id is not null then
    if not exists (select 1 from public.projects p where p.id = new.project_id and p.organization_id = new.organization_id) then
      raise exception 'project_id must belong to the same organization as the transaction';
    end if;
  end if;
  if new.client_id is not null then
    if not exists (select 1 from public.clients c where c.id = new.client_id and c.organization_id = new.organization_id) then
      raise exception 'client_id must belong to the same organization as the transaction';
    end if;
  end if;
  if new.recurrence_id is not null then
    if not exists (select 1 from public.financial_recurrences r where r.id = new.recurrence_id and r.organization_id = new.organization_id) then
      raise exception 'recurrence_id must belong to the same organization as the transaction';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_financial_transactions_validate_org on public.financial_transactions;
create trigger trg_financial_transactions_validate_org
  before insert or update on public.financial_transactions
  for each row execute function public.validate_financial_transaction_org();

-- ============================================================================
-- Default-data bootstrap RPCs — idempotent, mirror the seed lists the
-- IndexedDB versions of these modules already ship with. Each takes an
-- explicit target_org_id and re-checks membership itself (SECURITY DEFINER
-- functions never trust client input for authorization).
-- ============================================================================

create or replace function public.ensure_default_project_stages(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_names text[] := array['Briefing', 'Estudo Preliminar', 'Projeto Arquitetônico', 'Projeto Executivo', 'Render', 'Entrega'];
  v_name text;
  v_pos integer := 0;
begin
  if not public.is_organization_member(target_org_id) then
    raise exception 'Not a member of this organization';
  end if;

  perform pg_advisory_xact_lock(hashtext('ensure_default_project_stages:' || target_org_id::text));

  select count(*) into v_count from public.project_stages where organization_id = target_org_id;
  if v_count > 0 then
    return;
  end if;

  foreach v_name in array v_names loop
    insert into public.project_stages (organization_id, name, position) values (target_org_id, v_name, v_pos);
    v_pos := v_pos + 1;
  end loop;
end;
$$;

create or replace function public.ensure_default_financial_categories(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_income_names text[] := array['Honorários', 'Entrada de contrato', 'Parcela de projeto', 'Consultoria', 'Acompanhamento de obra', 'Renderização', 'Outros'];
  v_expense_names text[] := array['Software', 'Equipe', 'Freelancer', 'Impostos', 'Marketing', 'Equipamentos', 'Impressão', 'Deslocamento', 'Serviços terceirizados', 'Escritório', 'Internet', 'Outros'];
  v_name text;
begin
  if not public.is_organization_member(target_org_id) then
    raise exception 'Not a member of this organization';
  end if;

  perform pg_advisory_xact_lock(hashtext('ensure_default_financial_categories:' || target_org_id::text));

  select count(*) into v_count from public.financial_categories where organization_id = target_org_id;
  if v_count > 0 then
    return;
  end if;

  foreach v_name in array v_income_names loop
    insert into public.financial_categories (organization_id, name, type, is_default) values (target_org_id, v_name, 'income', true);
  end loop;
  foreach v_name in array v_expense_names loop
    insert into public.financial_categories (organization_id, name, type, is_default) values (target_org_id, v_name, 'expense', true);
  end loop;
end;
$$;

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.clients enable row level security;
alter table public.project_stages enable row level security;
alter table public.projects enable row level security;
alter table public.project_tasks enable row level security;
alter table public.project_tags enable row level security;
alter table public.project_tag_links enable row level security;
alter table public.project_history enable row level security;
alter table public.financial_categories enable row level security;
alter table public.financial_recurrences enable row level security;
alter table public.financial_transactions enable row level security;

-- clients: any member can view/create/update; delete restricted to admin/owner.
drop policy if exists "clients_select_member" on public.clients;
create policy "clients_select_member" on public.clients for select using (public.is_organization_member(organization_id));
drop policy if exists "clients_insert_member" on public.clients;
create policy "clients_insert_member" on public.clients for insert with check (public.is_organization_member(organization_id));
drop policy if exists "clients_update_member" on public.clients;
create policy "clients_update_member" on public.clients for update using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
drop policy if exists "clients_delete_admin" on public.clients;
create policy "clients_delete_admin" on public.clients for delete using (public.is_organization_admin(organization_id));

-- project_stages: any member can view; admin/owner shapes the org-wide stage structure.
drop policy if exists "project_stages_select_member" on public.project_stages;
create policy "project_stages_select_member" on public.project_stages for select using (public.is_organization_member(organization_id));
drop policy if exists "project_stages_insert_admin" on public.project_stages;
create policy "project_stages_insert_admin" on public.project_stages for insert with check (public.is_organization_admin(organization_id));
drop policy if exists "project_stages_update_admin" on public.project_stages;
create policy "project_stages_update_admin" on public.project_stages for update using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));
drop policy if exists "project_stages_delete_admin" on public.project_stages;
create policy "project_stages_delete_admin" on public.project_stages for delete using (public.is_organization_admin(organization_id));

-- projects: any member can view/create/edit/move cards; hard delete restricted to admin/owner (archiving is just an update, open to members).
drop policy if exists "projects_select_member" on public.projects;
create policy "projects_select_member" on public.projects for select using (public.is_organization_member(organization_id));
drop policy if exists "projects_insert_member" on public.projects;
create policy "projects_insert_member" on public.projects for insert with check (public.is_organization_member(organization_id));
drop policy if exists "projects_update_member" on public.projects;
create policy "projects_update_member" on public.projects for update using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
drop policy if exists "projects_delete_admin" on public.projects;
create policy "projects_delete_admin" on public.projects for delete using (public.is_organization_admin(organization_id));

-- project_tasks: fully member-editable — a checklist is a day-to-day collaboration tool, not sensitive data.
drop policy if exists "project_tasks_select_member" on public.project_tasks;
create policy "project_tasks_select_member" on public.project_tasks for select using (public.is_organization_member(organization_id));
drop policy if exists "project_tasks_insert_member" on public.project_tasks;
create policy "project_tasks_insert_member" on public.project_tasks for insert with check (public.is_organization_member(organization_id));
drop policy if exists "project_tasks_update_member" on public.project_tasks;
create policy "project_tasks_update_member" on public.project_tasks for update using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
drop policy if exists "project_tasks_delete_member" on public.project_tasks;
create policy "project_tasks_delete_member" on public.project_tasks for delete using (public.is_organization_member(organization_id));

-- project_tags: any member can view/create; delete restricted to admin/owner (a shared taxonomy — removing a tag affects every project using it).
drop policy if exists "project_tags_select_member" on public.project_tags;
create policy "project_tags_select_member" on public.project_tags for select using (public.is_organization_member(organization_id));
drop policy if exists "project_tags_insert_member" on public.project_tags;
create policy "project_tags_insert_member" on public.project_tags for insert with check (public.is_organization_member(organization_id));
drop policy if exists "project_tags_delete_admin" on public.project_tags;
create policy "project_tags_delete_admin" on public.project_tags for delete using (public.is_organization_admin(organization_id));

-- project_tag_links: any member can attach/detach a tag to a project they can see.
drop policy if exists "project_tag_links_select_member" on public.project_tag_links;
create policy "project_tag_links_select_member" on public.project_tag_links for select using (public.is_organization_member(organization_id));
drop policy if exists "project_tag_links_insert_member" on public.project_tag_links;
create policy "project_tag_links_insert_member" on public.project_tag_links for insert with check (public.is_organization_member(organization_id));
drop policy if exists "project_tag_links_delete_member" on public.project_tag_links;
create policy "project_tag_links_delete_member" on public.project_tag_links for delete using (public.is_organization_member(organization_id));

-- project_history: append-only audit trail — any member can view/write (moving a card, which any member can do, must be able to log it); no update/delete policy exists, matching the current UI (history is never edited or removed).
drop policy if exists "project_history_select_member" on public.project_history;
create policy "project_history_select_member" on public.project_history for select using (public.is_organization_member(organization_id));
drop policy if exists "project_history_insert_member" on public.project_history;
create policy "project_history_insert_member" on public.project_history for insert with check (public.is_organization_member(organization_id));

-- Financeiro: restricted to owner/admin by default (per explicit product
-- decision — see the Phase 1 report). Members see Projetos/Clientes but not
-- financial data. Policies are structured per-action so this can be loosened
-- to members later without a schema change.
drop policy if exists "financial_categories_select_admin" on public.financial_categories;
create policy "financial_categories_select_admin" on public.financial_categories for select using (public.is_organization_admin(organization_id));
drop policy if exists "financial_categories_insert_admin" on public.financial_categories;
create policy "financial_categories_insert_admin" on public.financial_categories for insert with check (public.is_organization_admin(organization_id));
drop policy if exists "financial_categories_update_admin" on public.financial_categories;
create policy "financial_categories_update_admin" on public.financial_categories for update using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));
drop policy if exists "financial_categories_delete_admin" on public.financial_categories;
create policy "financial_categories_delete_admin" on public.financial_categories for delete using (public.is_organization_admin(organization_id));

drop policy if exists "financial_recurrences_select_admin" on public.financial_recurrences;
create policy "financial_recurrences_select_admin" on public.financial_recurrences for select using (public.is_organization_admin(organization_id));
drop policy if exists "financial_recurrences_insert_admin" on public.financial_recurrences;
create policy "financial_recurrences_insert_admin" on public.financial_recurrences for insert with check (public.is_organization_admin(organization_id));
drop policy if exists "financial_recurrences_update_admin" on public.financial_recurrences;
create policy "financial_recurrences_update_admin" on public.financial_recurrences for update using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));
drop policy if exists "financial_recurrences_delete_admin" on public.financial_recurrences;
create policy "financial_recurrences_delete_admin" on public.financial_recurrences for delete using (public.is_organization_admin(organization_id));

drop policy if exists "financial_transactions_select_admin" on public.financial_transactions;
create policy "financial_transactions_select_admin" on public.financial_transactions for select using (public.is_organization_admin(organization_id));
drop policy if exists "financial_transactions_insert_admin" on public.financial_transactions;
create policy "financial_transactions_insert_admin" on public.financial_transactions for insert with check (public.is_organization_admin(organization_id));
drop policy if exists "financial_transactions_update_admin" on public.financial_transactions;
create policy "financial_transactions_update_admin" on public.financial_transactions for update using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id));
drop policy if exists "financial_transactions_delete_admin" on public.financial_transactions;
create policy "financial_transactions_delete_admin" on public.financial_transactions for delete using (public.is_organization_admin(organization_id));
