create table if not exists public.d2f_integrations (
  owner_email text not null,
  integration_type text not null check (integration_type in ('pa', 'archive', 'email')),
  config jsonb not null default '{}'::jsonb,
  secret_encrypted text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_email, integration_type)
);

create table if not exists public.d2f_transmissions (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  channel text not null check (channel in ('pa', 'archive', 'email')),
  document_id text,
  document_number text,
  status text not null,
  remote_id text,
  receipt jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists d2f_transmissions_owner_created_idx
  on public.d2f_transmissions(owner_email, created_at desc);

alter table public.d2f_integrations enable row level security;
alter table public.d2f_transmissions enable row level security;

revoke all on public.d2f_integrations from anon, authenticated;
revoke all on public.d2f_transmissions from anon, authenticated;
grant all on public.d2f_integrations to service_role;
grant all on public.d2f_transmissions to service_role;

comment on table public.d2f_integrations is 'Configuration publique et secrets chiffrés des connecteurs PA, SAE et e-mail';
comment on column public.d2f_integrations.secret_encrypted is 'Secret AES-GCM, jamais renvoyé au navigateur';
comment on table public.d2f_transmissions is 'Reçus et statuts des transmissions vers PA, SAE et service e-mail';
