-- Réparation autonome du stockage Support D2F.
-- Ce script peut être relancé sans supprimer ni modifier les tickets existants.
-- Il ne dépend pas de l'ordre d'exécution des migrations SaaS précédentes.

create extension if not exists pgcrypto;

create sequence if not exists public.d2f_support_ticket_seq start with 1001;

create table if not exists public.d2f_support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique
    default ('D2F-' || lpad(nextval('public.d2f_support_ticket_seq')::text, 6, '0')),
  -- L'identifiant reste volontairement sans clé étrangère : certains comptes
  -- historiques sont encore conservés dans d2f_company._saas_account.
  -- L'isolation par entreprise est contrôlée côté serveur avec la session signée.
  tenant_id uuid not null,
  owner_key text not null,
  company_name text not null default '',
  requester_user_id uuid references auth.users(id) on delete set null,
  requester_name text not null default '',
  requester_email text not null,
  contact_email text not null,
  locale text not null default 'fr'
    check (locale in ('fr','en','sr','it','es')),
  category text not null
    check (category in ('access','billing','invoice','payment','einvoicing','reporting','compliance','technical','other')),
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  subject text not null,
  description text not null,
  status text not null default 'open'
    check (status in ('open','in_progress','waiting_customer','resolved','closed')),
  assigned_to text not null default '',
  external_provider text not null default '',
  external_key text not null default '',
  external_url text not null default '',
  l1_mode text not null default 'guided',
  l1_summary text not null default '',
  resolution text not null default '',
  resolved_at timestamptz,
  closed_at timestamptz,
  ticket_scope text not null default 'customer'
    check (ticket_scope in ('customer','internal')),
  request_type text not null default 'incident'
    check (request_type in ('incident','need','question')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Complète une table créée par la première migration Support.
alter table public.d2f_support_tickets
  add column if not exists ticket_scope text not null default 'customer';

alter table public.d2f_support_tickets
  add column if not exists request_type text not null default 'incident';

-- Retire uniquement l'ancienne dépendance susceptible de bloquer les comptes
-- historiques. Les tickets restent conservés même si un compte est suspendu.
alter table public.d2f_support_tickets
  drop constraint if exists d2f_support_tickets_tenant_id_fkey;

alter table public.d2f_support_tickets
  drop constraint if exists d2f_support_tickets_ticket_scope_check;

alter table public.d2f_support_tickets
  add constraint d2f_support_tickets_ticket_scope_check
  check (ticket_scope in ('customer','internal'));

alter table public.d2f_support_tickets
  drop constraint if exists d2f_support_tickets_request_type_check;

alter table public.d2f_support_tickets
  add constraint d2f_support_tickets_request_type_check
  check (request_type in ('incident','need','question'));

create table if not exists public.d2f_support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.d2f_support_tickets(id) on delete cascade,
  author_type text not null
    check (author_type in ('requester','support','assistant','system')),
  author_name text not null default '',
  author_email text not null default '',
  body text not null,
  internal boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.d2f_support_notifications (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.d2f_support_tickets(id) on delete cascade,
  recipient text not null,
  subject text not null,
  body text not null,
  delivery_status text not null default 'queued'
    check (delivery_status in ('queued','sent','failed','configuration_required')),
  attempts integer not null default 0,
  last_error text not null default '',
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists d2f_support_tickets_tenant_idx
  on public.d2f_support_tickets(tenant_id, updated_at desc);
create index if not exists d2f_support_tickets_status_idx
  on public.d2f_support_tickets(status, priority, updated_at desc);
create index if not exists d2f_support_messages_ticket_idx
  on public.d2f_support_messages(ticket_id, created_at);
create index if not exists d2f_support_notifications_status_idx
  on public.d2f_support_notifications(delivery_status, created_at);

alter table public.d2f_support_tickets enable row level security;
alter table public.d2f_support_messages enable row level security;
alter table public.d2f_support_notifications enable row level security;

revoke all on public.d2f_support_tickets from anon, authenticated;
revoke all on public.d2f_support_messages from anon, authenticated;
revoke all on public.d2f_support_notifications from anon, authenticated;

grant all on public.d2f_support_tickets to service_role;
grant all on public.d2f_support_messages to service_role;
grant all on public.d2f_support_notifications to service_role;
grant usage, select on sequence public.d2f_support_ticket_seq to service_role;

comment on table public.d2f_support_tickets is
  'Tickets D2F isolés par entreprise et conservés jusqu''à leur clôture';
comment on table public.d2f_support_messages is
  'Historique horodaté des échanges et changements de statut des tickets D2F';
comment on table public.d2f_support_notifications is
  'File de notifications e-mail du support D2F avec état de livraison';

-- Force PostgREST à voir immédiatement les nouvelles tables après Run.
notify pgrst, 'reload schema';

-- Contrôle visible dans le SQL Editor : les trois lignes doivent afficher OK.
select expected_table,
  case when to_regclass('public.' || expected_table) is not null then 'OK' else 'MANQUANTE' end as etat
from (values
  ('d2f_support_tickets'),
  ('d2f_support_messages'),
  ('d2f_support_notifications')
) as verification(expected_table);
