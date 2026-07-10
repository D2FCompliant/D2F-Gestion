create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  name text not null check (char_length(name) between 2 and 120),
  company text not null check (char_length(company) between 2 and 160),
  email text not null,
  phone text,
  status text not null default 'Prospect' check (status in ('Actif', 'Prospect', 'En pause')),
  monthly_revenue numeric(12,2) not null default 0 check (monthly_revenue >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.dossiers (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 180),
  status text not null default 'À qualifier' check (status in ('À qualifier', 'En cours', 'En revue', 'Terminé')),
  due_date date not null,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  progress integer not null default 0 check (progress between 0 and 100),
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  dossier_id uuid references public.dossiers(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 200),
  due_date date not null,
  priority text not null default 'Normale' check (priority in ('Haute', 'Normale', 'Basse')),
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists clients_owner_email_idx on public.clients(owner_email);
create index if not exists dossiers_owner_email_idx on public.dossiers(owner_email);
create index if not exists dossiers_client_id_idx on public.dossiers(client_id);
create index if not exists tasks_owner_email_due_date_idx on public.tasks(owner_email, due_date);
create index if not exists tasks_dossier_id_idx on public.tasks(dossier_id);

alter table public.clients enable row level security;
alter table public.dossiers enable row level security;
alter table public.tasks enable row level security;

revoke all on public.clients from anon, authenticated;
revoke all on public.dossiers from anon, authenticated;
revoke all on public.tasks from anon, authenticated;
grant all on public.clients to service_role;
grant all on public.dossiers to service_role;
grant all on public.tasks to service_role;

comment on table public.clients is 'Portefeuille clients privé de D2F Gestion';
comment on table public.dossiers is 'Dossiers et missions suivis dans D2F Gestion';
comment on table public.tasks is 'Actions et échéances rattachées aux dossiers';
