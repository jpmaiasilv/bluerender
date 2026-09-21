-- Blue Render — Financeiro evolution: installments, real attachments (reusing
-- project_files/Storage instead of IndexedDB blobs), and a richer default
-- category seed. Purely incremental — no table is dropped/recreated, no
-- existing row is touched. Idempotent: safe to re-run.

-- ============================================================================
-- 1. project_files.project_id becomes nullable, so a financial attachment
-- with no linked obra (a general office expense) can still get a real
-- project_files row. A composite FK skips validation entirely when any of
-- its columns is NULL (standard Postgres MATCH SIMPLE behavior), so the
-- existing `foreign key (project_id, organization_id) references
-- projects (id, organization_id)` needs no change — it simply stops being
-- checked for rows where project_id is null.
-- ============================================================================

alter table public.project_files alter column project_id drop not null;

-- ============================================================================
-- 2. financial_transactions: attachment reference + installment plan fields.
-- ============================================================================

alter table public.financial_transactions
  add column if not exists attachment_file_id uuid references public.project_files (id) on delete set null;

alter table public.financial_transactions
  add column if not exists installment_group_id uuid;
alter table public.financial_transactions
  add column if not exists installment_number integer check (installment_number is null or installment_number > 0);
alter table public.financial_transactions
  add column if not exists installment_total integer check (installment_total is null or installment_total > 0);

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'financial_transactions' and constraint_name = 'financial_transactions_installment_fields_together'
  ) then
    alter table public.financial_transactions
      add constraint financial_transactions_installment_fields_together
      check (
        (installment_group_id is null and installment_number is null and installment_total is null)
        or (installment_group_id is not null and installment_number is not null and installment_total is not null)
      );
  end if;
end $$;

create index if not exists idx_financial_transactions_installment_group_id on public.financial_transactions (installment_group_id);
create index if not exists idx_financial_transactions_attachment_file_id on public.financial_transactions (attachment_file_id);

-- Cross-tenant guard for the new attachment link (mirrors the existing
-- project_id/client_id/recurrence_id checks in the same trigger function).
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
  if new.attachment_file_id is not null then
    if not exists (select 1 from public.project_files f where f.id = new.attachment_file_id and f.organization_id = new.organization_id) then
      raise exception 'attachment_file_id must belong to the same organization as the transaction';
    end if;
  end if;
  return new;
end;
$$;

-- ============================================================================
-- 3. Richer default category seed — additive only. New organizations get the
-- expanded list from creation; existing organizations get any category from
-- this list they don't already have (matched by name+type) inserted
-- alongside whatever they've already customized. Nothing is ever removed or
-- renamed.
-- ============================================================================

create or replace function public.ensure_default_financial_categories(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_income_names text[] := array[
    'Honorários', 'Projeto arquitetônico', 'Projeto complementar', 'Renderização',
    'Consultoria', 'Acompanhamento de obra', 'Entrada de contrato', 'Parcela de projeto', 'Outros'
  ];
  v_expense_names text[] := array[
    'Software', 'Impostos', 'Marketing', 'Serviços terceirizados', 'Deslocamento',
    'Equipamentos', 'Aluguel', 'Contabilidade', 'Internet', 'Materiais',
    'Equipe', 'Freelancer', 'Impressão', 'Escritório', 'Outros'
  ];
  v_name text;
begin
  if not public.is_organization_member(target_org_id) then
    raise exception 'Not a member of this organization';
  end if;

  perform pg_advisory_xact_lock(hashtext('ensure_default_financial_categories:' || target_org_id::text));

  select count(*) into v_count from public.financial_categories where organization_id = target_org_id;
  if v_count = 0 then
    foreach v_name in array v_income_names loop
      insert into public.financial_categories (organization_id, name, type, is_default) values (target_org_id, v_name, 'income', true);
    end loop;
    foreach v_name in array v_expense_names loop
      insert into public.financial_categories (organization_id, name, type, is_default) values (target_org_id, v_name, 'expense', true);
    end loop;
    return;
  end if;

  -- Existing org: backfill only the names it doesn't already have (case-insensitive match), never touching what's there.
  foreach v_name in array v_income_names loop
    if not exists (select 1 from public.financial_categories where organization_id = target_org_id and type = 'income' and lower(name) = lower(v_name)) then
      insert into public.financial_categories (organization_id, name, type, is_default) values (target_org_id, v_name, 'income', true);
    end if;
  end loop;
  foreach v_name in array v_expense_names loop
    if not exists (select 1 from public.financial_categories where organization_id = target_org_id and type = 'expense' and lower(name) = lower(v_name)) then
      insert into public.financial_categories (organization_id, name, type, is_default) values (target_org_id, v_name, 'expense', true);
    end if;
  end loop;
end;
$$;

-- Backfill immediately for every organization that already exists, so
-- current users see the new categories without needing to re-trigger
-- onboarding. Runs the same additive logic directly (not through the RPC
-- above) because that RPC's is_organization_member() check requires a real
-- auth.uid() session, which a migration script run as the database owner
-- doesn't have — this block IS the trusted context, so it's safe to insert
-- directly. Only ever inserts, never touches an existing row.
do $$
declare
  v_org record;
  v_income_names text[] := array[
    'Honorários', 'Projeto arquitetônico', 'Projeto complementar', 'Renderização',
    'Consultoria', 'Acompanhamento de obra', 'Entrada de contrato', 'Parcela de projeto', 'Outros'
  ];
  v_expense_names text[] := array[
    'Software', 'Impostos', 'Marketing', 'Serviços terceirizados', 'Deslocamento',
    'Equipamentos', 'Aluguel', 'Contabilidade', 'Internet', 'Materiais',
    'Equipe', 'Freelancer', 'Impressão', 'Escritório', 'Outros'
  ];
  v_name text;
begin
  for v_org in select id from public.organizations loop
    foreach v_name in array v_income_names loop
      if not exists (select 1 from public.financial_categories where organization_id = v_org.id and type = 'income' and lower(name) = lower(v_name)) then
        insert into public.financial_categories (organization_id, name, type, is_default) values (v_org.id, v_name, 'income', true);
      end if;
    end loop;
    foreach v_name in array v_expense_names loop
      if not exists (select 1 from public.financial_categories where organization_id = v_org.id and type = 'expense' and lower(name) = lower(v_name)) then
        insert into public.financial_categories (organization_id, name, type, is_default) values (v_org.id, v_name, 'expense', true);
      end if;
    end loop;
  end loop;
end $$;

notify pgrst, 'reload schema';
