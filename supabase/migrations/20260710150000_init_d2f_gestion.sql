create extension if not exists pgcrypto;

create table if not exists public.d2f_company (
  owner_email text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.d2f_records (
  id text primary key default gen_random_uuid()::text,
  owner_email text not null,
  entity text not null check (entity in ('clients', 'items', 'quotes', 'invoices', 'payments', 'inbound')),
  search_text text not null default '',
  status text not null default '',
  document_number text not null default '',
  document_date date,
  parent_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists d2f_records_owner_entity_idx on public.d2f_records(owner_email, entity);
create index if not exists d2f_records_owner_status_idx on public.d2f_records(owner_email, entity, status);
create index if not exists d2f_records_parent_idx on public.d2f_records(owner_email, entity, parent_id);
create index if not exists d2f_records_document_date_idx on public.d2f_records(owner_email, entity, document_date desc);
create index if not exists d2f_records_search_idx on public.d2f_records using gin (to_tsvector('simple', search_text));

alter table public.d2f_company enable row level security;
alter table public.d2f_records enable row level security;

revoke all on public.d2f_company from anon, authenticated;
revoke all on public.d2f_records from anon, authenticated;
grant all on public.d2f_company to service_role;
grant all on public.d2f_records to service_role;

comment on table public.d2f_company is 'Paramètres société de D2F Gestion, isolés par utilisateur authentifié';
comment on table public.d2f_records is 'Stockage Supabase des clients, articles, devis, factures, paiements et documents entrants';
