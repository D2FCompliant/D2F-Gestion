-- D2F Platform 3.4.0 - distinct company-expense and travel-order workflows.
-- Rates and legal decisions are frozen at explicit validation time.

alter table public.d2f_expense_reports
  add column if not exists document_type text not null default 'company_expense',
  add column if not exists workflow_data jsonb not null default '{}'::jsonb,
  add column if not exists mission_report text,
  add column if not exists business_necessity text,
  add column if not exists validated_at timestamptz,
  add column if not exists validated_by text,
  add column if not exists validation_rate_date date,
  add column if not exists country_pack_id text,
  add column if not exists country_pack_version text,
  add column if not exists country_pack_hash text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'd2f_expense_report_document_type_chk') then
    alter table public.d2f_expense_reports add constraint d2f_expense_report_document_type_chk
      check (document_type in ('company_expense','travel_order'));
  end if;
end $$;

create table if not exists public.d2f_expense_exchange_rates (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.d2f_expense_reports(id) on delete cascade,
  rate_date date not null,
  source text not null,
  source_uri text not null,
  base_currency char(3) not null,
  quote_currency char(3) not null,
  rate numeric(24,10) not null check (rate > 0),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  raw_snapshot jsonb not null default '{}'::jsonb,
  validated_at timestamptz not null,
  validated_by text not null,
  created_at timestamptz not null default now(),
  unique (report_id, rate_date, base_currency, quote_currency)
);

create table if not exists public.d2f_expense_exports (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.d2f_expense_reports(id) on delete cascade,
  export_type text not null check (export_type in ('accountant','bank_reimbursement','travel_order','travel_account')),
  format text not null check (format in ('csv','pdf')),
  file_name text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  generated_at timestamptz not null default now(),
  generated_by text not null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists d2f_expense_exchange_rates_report_idx on public.d2f_expense_exchange_rates(report_id,rate_date);
create index if not exists d2f_expense_exports_report_idx on public.d2f_expense_exports(report_id,generated_at desc);
alter table public.d2f_expense_exchange_rates enable row level security;
alter table public.d2f_expense_exports enable row level security;
revoke all on public.d2f_expense_exchange_rates from anon,authenticated;
revoke all on public.d2f_expense_exports from anon,authenticated;
grant all on public.d2f_expense_exchange_rates to service_role;
grant all on public.d2f_expense_exports to service_role;
