-- Blue Render — Billing Subscriptions
-- One row per organization holding its current Stripe subscription state.
-- Written only by the backend (service_role, bypasses RLS) from verified
-- Stripe webhook events — never from a value the browser sends directly.
-- Idempotent: safe to re-run against a database that already has this applied.
--
-- Reuses public.set_updated_at() and public.is_organization_member(org_id)
-- from 20260826120000_auth_foundation.sql — no duplicate helpers/tables.

create table if not exists public.organization_subscriptions (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text check (plan in ('starter', 'pro', 'studio')),
  billing_interval text check (billing_interval in ('monthly', 'yearly')),
  status text not null default 'inactive'
    check (status in ('inactive', 'trialing', 'active', 'past_due', 'canceled', 'unpaid')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_org_subscriptions_stripe_customer_id
  on public.organization_subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists idx_org_subscriptions_stripe_subscription_id
  on public.organization_subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

drop trigger if exists trg_organization_subscriptions_updated_at on public.organization_subscriptions;
create trigger trg_organization_subscriptions_updated_at
  before update on public.organization_subscriptions
  for each row execute function public.set_updated_at();

alter table public.organization_subscriptions enable row level security;

-- Members can see their own organization's billing status (e.g. to show
-- "Plano Pro ativo" in the UI). No insert/update/delete policy for any
-- client role — the backend service_role key bypasses RLS and is the only
-- writer, driven exclusively by signature-verified Stripe webhook events.
drop policy if exists organization_subscriptions_select on public.organization_subscriptions;
create policy organization_subscriptions_select
  on public.organization_subscriptions
  for select
  using (public.is_organization_member(organization_id));
