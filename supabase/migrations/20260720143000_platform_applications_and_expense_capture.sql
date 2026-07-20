-- Product entitlements and smartphone receipt provenance for D2F Platform.

create table if not exists public.d2f_tenant_applications (
  tenant_id uuid not null references public.d2f_tenants(id) on delete cascade,
  application text not null check (application in ('financial', 'expenses')),
  status text not null default 'active' check (status in ('trial', 'active', 'suspended', 'cancelled')),
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, application)
);

create index if not exists d2f_tenant_applications_active_idx
  on public.d2f_tenant_applications (tenant_id, application, status, effective_until);

alter table public.d2f_tenant_applications enable row level security;
revoke all on public.d2f_tenant_applications from anon, authenticated;
grant all on public.d2f_tenant_applications to service_role;

alter table public.d2f_expense_receipts
  add column if not exists capture_context jsonb not null default '{}'::jsonb,
  add column if not exists capture_location jsonb not null default '{}'::jsonb;

comment on table public.d2f_tenant_applications is
  'Server-authoritative optional D2F application entitlements. D2F Gestion remains the base application.';

comment on column public.d2f_expense_receipts.capture_context is
  'Authorized device and browser context captured with a mobile receipt upload.';

comment on column public.d2f_expense_receipts.capture_location is
  'Optional user-authorized location; empty when consent was not granted.';
