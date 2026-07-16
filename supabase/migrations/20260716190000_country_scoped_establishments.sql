-- Cette migration est volontairement autonome : elle peut être exécutée
-- même si la migration SaaS précédente n'a pas encore été appliquée.
create table if not exists public.d2f_tenants (
  id uuid primary key default gen_random_uuid(),
  company_identifier text not null unique,
  name text not null,
  country text not null default 'FR',
  owner_key text not null unique,
  plan_code text not null check (plan_code in ('monthly', 'lifetime')),
  seat_limit integer not null default 2 check (seat_limit between 1 and 100),
  status text not null check (status in ('lifetime', 'pending_payment', 'payment_declared', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.d2f_tenant_members (
  tenant_id uuid not null references public.d2f_tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null check (role in ('owner', 'collaborator')),
  status text not null check (status in ('active', 'invited')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id),
  unique (user_id)
);

create table if not exists public.d2f_subscriptions (
  tenant_id uuid primary key references public.d2f_tenants(id) on delete cascade,
  billing_cycle text not null check (billing_cycle in ('monthly', 'lifetime')),
  amount_eur numeric(12,2),
  currency text not null default 'EUR',
  payment_method text not null check (payment_method in ('bank_transfer', 'none')),
  bank_transfer_reference text not null default '',
  payer_name text not null default '',
  customer_transfer_reference text not null default '',
  paid_on date,
  status text not null check (status in ('lifetime', 'pending_payment', 'payment_declared', 'active', 'suspended')),
  current_period_start date,
  current_period_end date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists d2f_tenant_members_email_idx
  on public.d2f_tenant_members (lower(email));

create index if not exists d2f_tenants_status_idx
  on public.d2f_tenants(status, created_at desc);

create index if not exists d2f_tenant_members_tenant_idx
  on public.d2f_tenant_members(tenant_id);

alter table public.d2f_tenants enable row level security;
alter table public.d2f_tenant_members enable row level security;
alter table public.d2f_subscriptions enable row level security;

revoke all on public.d2f_tenants from anon, authenticated;
revoke all on public.d2f_tenant_members from anon, authenticated;
revoke all on public.d2f_subscriptions from anon, authenticated;
grant all on public.d2f_tenants to service_role;
grant all on public.d2f_tenant_members to service_role;
grant all on public.d2f_subscriptions to service_role;

alter table public.d2f_tenants
  add column if not exists identifier_type text not null default 'NATIONAL_ID';

alter table public.d2f_tenants
  drop constraint if exists d2f_tenants_company_identifier_key;

create unique index if not exists d2f_tenants_country_company_identifier_idx
  on public.d2f_tenants (upper(country), upper(company_identifier));

update public.d2f_tenants
set identifier_type = case upper(country)
  when 'FR' then 'SIRET'
  when 'RS' then 'PIB'
  when 'IT' then 'PARTITA_IVA_OR_CF'
  when 'ES' then 'NIF'
  else 'NATIONAL_ID'
end;

comment on column public.d2f_tenants.company_identifier is
  'Identifiant de l’établissement facturant, unique à l’intérieur du pays (SIRET en France)';

comment on column public.d2f_tenants.identifier_type is
  'Type national de l’identifiant d’établissement : SIRET, PIB, Partita IVA/Codice Fiscale, NIF ou autre';
