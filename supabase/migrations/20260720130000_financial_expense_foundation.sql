-- D2F Financial and D2F Expense bounded contexts.
-- This migration also aligns the unpublished platform backbone with DPRA chapter 9.

alter table public.d2f_event_outbox
  drop constraint if exists d2f_event_outbox_type_version_chk,
  drop constraint if exists d2f_event_outbox_envelope_type_chk;

alter table public.d2f_event_outbox
  add constraint d2f_event_outbox_type_version_chk
    check (event_type ~ '^[A-Z][A-Za-z0-9]+$'),
  add constraint d2f_event_outbox_envelope_type_chk
    check (envelope ->> 'eventType' = event_type),
  add constraint d2f_event_outbox_envelope_version_chk
    check ((envelope ->> 'eventVersion')::integer = event_version);

drop index if exists public.d2f_pa_connectors_one_active_inbound_idx;
create unique index if not exists d2f_pa_connectors_one_inbound_default_idx
  on public.d2f_pa_connectors (owner_key)
  where enabled and is_default_inbound and direction in ('inbound', 'both');

create or replace function public.d2f_canonical_event_v1(
  p_event_id uuid,
  p_event_type text,
  p_event_version integer,
  p_occurred_at timestamptz,
  p_application text,
  p_service text,
  p_application_version text,
  p_aggregate_type text,
  p_aggregate_id text,
  p_aggregate_version bigint,
  p_tenant_id text,
  p_actor_type text,
  p_actor_id text,
  p_correlation_id uuid,
  p_causation_id uuid,
  p_schema_id text,
  p_country text,
  p_contains_personal_data boolean,
  p_contains_financial_data boolean,
  p_payload jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'eventId', p_event_id,
    'eventType', p_event_type,
    'eventVersion', p_event_version,
    'eventCategory', 'business',
    'occurredAt', p_occurred_at,
    'recordedAt', p_occurred_at,
    'producer', jsonb_build_object(
      'application', p_application,
      'service', p_service,
      'instance', null,
      'version', p_application_version
    ),
    'subject', jsonb_build_object(
      'aggregateType', p_aggregate_type,
      'aggregateId', p_aggregate_id,
      'aggregateVersion', p_aggregate_version
    ),
    'context', jsonb_build_object(
      'tenantId', p_tenant_id,
      'organizationId', null,
      'legalEntityId', null,
      'establishmentId', null,
      'countryContext', nullif(upper(p_country), ''),
      'languageContext', null
    ),
    'actor', jsonb_build_object(
      'actorType', p_actor_type,
      'actorId', p_actor_id,
      'delegatedBy', null
    ),
    'trace', jsonb_build_object(
      'correlationId', p_correlation_id,
      'causationId', p_causation_id,
      'commandId', null,
      'workflowInstanceId', null,
      'traceId', null
    ),
    'contract', jsonb_build_object(
      'schemaId', p_schema_id,
      'schemaVersion', p_event_version,
      'contentType', 'application/json'
    ),
    'security', jsonb_build_object(
      'classification', 'confidential',
      'containsPersonalData', p_contains_personal_data,
      'containsFinancialData', p_contains_financial_data,
      'encryptionRequired', true
    ),
    'payload', p_payload,
    'metadata', coalesce(p_metadata, '{}'::jsonb)
  );
$$;

create table if not exists public.d2f_financial_invoice_projections (
  owner_key text not null,
  tenant_id text not null,
  invoice_id text not null,
  source_event_id uuid not null unique,
  invoice_number text not null,
  invoice_type text not null,
  issue_date date not null,
  due_date date,
  customer_id text,
  customer_name text not null,
  currency char(3) not null,
  net_amount numeric(20,6) not null,
  tax_amount numeric(20,6) not null,
  gross_amount numeric(20,6) not null,
  source_payload jsonb not null,
  projected_at timestamptz not null default now(),
  primary key (owner_key, invoice_id)
);

create table if not exists public.d2f_financial_accounting_proposals (
  id uuid primary key default gen_random_uuid(),
  owner_key text not null,
  tenant_id text not null,
  source_type text not null check (source_type in ('CustomerInvoice', 'ExpenseReport')),
  source_id text not null,
  source_event_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'validated', 'posted', 'rejected')),
  currency char(3) not null,
  amount numeric(20,6) not null,
  proposal jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  posted_at timestamptz,
  unique (owner_key, source_type, source_id)
);

create table if not exists public.d2f_expense_reports (
  id uuid primary key default gen_random_uuid(),
  owner_key text not null,
  tenant_id text not null,
  report_number text not null,
  claimant_id text not null,
  claimant_name text,
  title text not null,
  currency char(3) not null default 'EUR',
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'returned')),
  total_net numeric(20,6) not null default 0,
  total_tax numeric(20,6) not null default 0,
  total_gross numeric(20,6) not null default 0,
  aggregate_version bigint not null default 1,
  submitted_at timestamptz,
  decided_at timestamptz,
  approver_id text,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_key, report_number)
);

create index if not exists d2f_expense_reports_queue_idx
  on public.d2f_expense_reports (owner_key, status, updated_at desc);

create table if not exists public.d2f_expense_lines (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.d2f_expense_reports(id) on delete cascade,
  occurred_on date not null,
  merchant text not null,
  description text not null,
  category text not null,
  business_purpose text not null,
  country char(2),
  currency char(3) not null,
  net_amount numeric(20,6) not null check (net_amount >= 0),
  tax_amount numeric(20,6) not null check (tax_amount >= 0),
  gross_amount numeric(20,6) not null check (gross_amount >= 0),
  reimbursable boolean,
  vat_recoverability text not null default 'pending'
    check (vat_recoverability in ('pending', 'recoverable', 'partial', 'non_recoverable')),
  receipt_required boolean not null default true,
  policy_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint d2f_expense_line_total_chk check (gross_amount = net_amount + tax_amount)
);

create index if not exists d2f_expense_lines_report_idx
  on public.d2f_expense_lines (report_id, occurred_on, id);

create table if not exists public.d2f_expense_receipts (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.d2f_expense_reports(id) on delete cascade,
  expense_line_id uuid references public.d2f_expense_lines(id) on delete set null,
  original_filename text not null,
  media_type text not null,
  byte_size bigint not null check (byte_size > 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  storage_reference text not null,
  captured_at timestamptz,
  uploaded_by text not null,
  origin text not null default 'manual_upload',
  extraction_status text not null default 'not_requested'
    check (extraction_status in ('not_requested', 'pending', 'suggested', 'validated', 'failed')),
  extraction jsonb not null default '{}'::jsonb,
  correction_history jsonb not null default '[]'::jsonb,
  duplicate_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (report_id, sha256)
);

alter table public.d2f_financial_invoice_projections enable row level security;
alter table public.d2f_financial_accounting_proposals enable row level security;
alter table public.d2f_expense_reports enable row level security;
alter table public.d2f_expense_lines enable row level security;
alter table public.d2f_expense_receipts enable row level security;

revoke all on public.d2f_financial_invoice_projections from anon, authenticated;
revoke all on public.d2f_financial_accounting_proposals from anon, authenticated;
revoke all on public.d2f_expense_reports from anon, authenticated;
revoke all on public.d2f_expense_lines from anon, authenticated;
revoke all on public.d2f_expense_receipts from anon, authenticated;

grant all on public.d2f_financial_invoice_projections to service_role;
grant all on public.d2f_financial_accounting_proposals to service_role;
grant all on public.d2f_expense_reports to service_role;
grant all on public.d2f_expense_lines to service_role;
grant all on public.d2f_expense_receipts to service_role;

create or replace function public.d2f_expense_submit_v1(
  p_owner_key text,
  p_report_id uuid,
  p_actor_id text,
  p_idempotency_key text,
  p_event_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  report_row public.d2f_expense_reports%rowtype;
  line_count integer;
  v_total_net numeric(20,6);
  v_total_tax numeric(20,6);
  v_total_gross numeric(20,6);
  event_envelope jsonb;
  occurred_at timestamptz := now();
begin
  if length(coalesce(p_idempotency_key, '')) not between 16 and 200 then
    raise exception 'Invalid idempotency key';
  end if;

  select * into report_row
  from public.d2f_expense_reports
  where id = p_report_id and owner_key = p_owner_key
  for update;

  if not found then raise exception 'Expense report not found'; end if;
  if report_row.status not in ('draft', 'returned') then
    raise exception 'Only a draft or returned report can be submitted';
  end if;

  select count(*), coalesce(sum(net_amount), 0), coalesce(sum(tax_amount), 0), coalesce(sum(gross_amount), 0)
  into line_count, v_total_net, v_total_tax, v_total_gross
  from public.d2f_expense_lines where report_id = p_report_id;

  if line_count = 0 then raise exception 'Expense report requires at least one line'; end if;

  update public.d2f_expense_reports
  set status = 'submitted', total_net = v_total_net, total_tax = v_total_tax,
      total_gross = v_total_gross, submitted_at = occurred_at,
      aggregate_version = aggregate_version + 1, updated_at = occurred_at
  where id = p_report_id;

  event_envelope := public.d2f_canonical_event_v1(
    p_event_id, 'ExpenseSubmitted', 1, occurred_at,
    'd2f-expense', 'expense-report-service', '1.0.0',
    'ExpenseReport', p_report_id::text, report_row.aggregate_version + 1,
    report_row.tenant_id, 'user', p_actor_id, p_correlation_id, null,
    'https://schemas.d2fcompliant.org/events/expense-submitted.v1.schema.json',
    null, true, true,
    jsonb_build_object(
      'expenseReportId', p_report_id,
      'reportNumber', report_row.report_number,
      'claimantId', report_row.claimant_id,
      'currency', report_row.currency,
      'totals', jsonb_build_object('net', v_total_net::text, 'tax', v_total_tax::text, 'gross', v_total_gross::text),
      'lineCount', line_count
    )
  );

  insert into public.d2f_event_outbox (
    event_id, owner_key, event_type, event_version, aggregate_type, aggregate_id,
    aggregate_version, correlation_id, idempotency_key, occurred_at, envelope
  ) values (
    p_event_id, p_owner_key, 'ExpenseSubmitted', 1, 'ExpenseReport', p_report_id::text,
    report_row.aggregate_version + 1, p_correlation_id, p_idempotency_key, occurred_at, event_envelope
  );

  return jsonb_build_object('id', p_report_id, 'status', 'submitted', 'eventId', p_event_id);
end;
$$;

create or replace function public.d2f_expense_decide_v1(
  p_owner_key text,
  p_report_id uuid,
  p_actor_id text,
  p_decision text,
  p_decision_note text,
  p_idempotency_key text,
  p_event_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  report_row public.d2f_expense_reports%rowtype;
  event_type text;
  event_envelope jsonb;
  occurred_at timestamptz := now();
begin
  if p_decision not in ('approved', 'rejected', 'returned') then raise exception 'Invalid expense decision'; end if;
  if length(coalesce(p_idempotency_key, '')) not between 16 and 200 then raise exception 'Invalid idempotency key'; end if;

  select * into report_row
  from public.d2f_expense_reports
  where id = p_report_id and owner_key = p_owner_key
  for update;

  if not found then raise exception 'Expense report not found'; end if;
  if report_row.status <> 'submitted' then raise exception 'Only a submitted report can be decided'; end if;

  event_type := case p_decision when 'approved' then 'ExpenseApproved'
    when 'rejected' then 'ExpenseRejected' else 'ExpenseReturnedForCorrection' end;

  update public.d2f_expense_reports
  set status = p_decision, decided_at = occurred_at, approver_id = p_actor_id,
      decision_note = nullif(p_decision_note, ''), aggregate_version = aggregate_version + 1,
      updated_at = occurred_at
  where id = p_report_id;

  event_envelope := public.d2f_canonical_event_v1(
    p_event_id, event_type, 1, occurred_at,
    'd2f-expense', 'expense-approval-service', '1.0.0',
    'ExpenseReport', p_report_id::text, report_row.aggregate_version + 1,
    report_row.tenant_id, 'user', p_actor_id, p_correlation_id, null,
    'https://schemas.d2fcompliant.org/events/' || lower(regexp_replace(event_type, '([a-z])([A-Z])', '\1-\2', 'g')) || '.v1.schema.json',
    null, true, true,
    jsonb_build_object(
      'expenseReportId', p_report_id,
      'reportNumber', report_row.report_number,
      'approverId', p_actor_id,
      'decisionNote', nullif(p_decision_note, ''),
      'currency', report_row.currency,
      'approvedGross', case when p_decision = 'approved' then report_row.total_gross::text else '0' end
    )
  );

  insert into public.d2f_event_outbox (
    event_id, owner_key, event_type, event_version, aggregate_type, aggregate_id,
    aggregate_version, correlation_id, idempotency_key, occurred_at, envelope
  ) values (
    p_event_id, p_owner_key, event_type, 1, 'ExpenseReport', p_report_id::text,
    report_row.aggregate_version + 1, p_correlation_id, p_idempotency_key, occurred_at, event_envelope
  );

  return jsonb_build_object('id', p_report_id, 'status', p_decision, 'eventId', p_event_id);
end;
$$;

create or replace function public.d2f_financial_consume_invoice_issued_v1(
  p_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $
declare
  source_event public.d2f_event_outbox%rowtype;
  payload jsonb;
  tenant_context text;
  proposal_id uuid;
begin
  if exists (
    select 1 from public.d2f_event_inbox
    where consumer = 'd2f-financial.customer-invoice-projection'
      and event_id = p_event_id and processed_at is not null
  ) then
    return jsonb_build_object('eventId', p_event_id, 'status', 'already_processed');
  end if;

  select * into source_event from public.d2f_event_outbox where event_id = p_event_id;
  if not found or source_event.event_type <> 'InvoiceIssued' then
    raise exception 'InvoiceIssued event not found';
  end if;

  payload := source_event.envelope -> 'payload';
  tenant_context := source_event.envelope #>> '{context,tenantId}';

  insert into public.d2f_financial_invoice_projections (
    owner_key, tenant_id, invoice_id, source_event_id, invoice_number, invoice_type,
    issue_date, due_date, customer_id, customer_name, currency,
    net_amount, tax_amount, gross_amount, source_payload
  ) values (
    source_event.owner_key, tenant_context, payload ->> 'invoiceId', source_event.event_id,
    payload ->> 'invoiceNumber', payload ->> 'invoiceType', (payload ->> 'issueDate')::date,
    nullif(payload ->> 'dueDate', '')::date, payload #>> '{buyer,id}', payload #>> '{buyer,name}',
    payload ->> 'currency', (payload #>> '{totals,net}')::numeric,
    (payload #>> '{totals,tax}')::numeric, (payload #>> '{totals,gross}')::numeric, payload
  )
  on conflict (owner_key, invoice_id) do update set
    source_event_id = excluded.source_event_id,
    invoice_number = excluded.invoice_number,
    due_date = excluded.due_date,
    customer_id = excluded.customer_id,
    customer_name = excluded.customer_name,
    net_amount = excluded.net_amount,
    tax_amount = excluded.tax_amount,
    gross_amount = excluded.gross_amount,
    source_payload = excluded.source_payload,
    projected_at = now();

  insert into public.d2f_financial_accounting_proposals (
    owner_key, tenant_id, source_type, source_id, source_event_id, currency, amount, proposal
  ) values (
    source_event.owner_key, tenant_context, 'CustomerInvoice', payload ->> 'invoiceId',
    source_event.event_id, payload ->> 'currency', (payload #>> '{totals,gross}')::numeric,
    jsonb_build_object(
      'kind', 'customer_invoice',
      'sourceNumber', payload ->> 'invoiceNumber',
      'status', 'requires_validation'
    )
  )
  on conflict (owner_key, source_type, source_id) do nothing
  returning id into proposal_id;

  insert into public.d2f_event_inbox (consumer, event_id, event_type, processed_at, attempts)
  values ('d2f-financial.customer-invoice-projection', source_event.event_id, source_event.event_type, now(), 1)
  on conflict (consumer, event_id) do update
    set processed_at = excluded.processed_at, attempts = public.d2f_event_inbox.attempts + 1, last_error = null;

  return jsonb_build_object(
    'eventId', p_event_id,
    'status', 'projected',
    'invoiceId', payload ->> 'invoiceId',
    'accountingProposalId', proposal_id
  );
end;
$;

create or replace function public.d2f_financial_consume_expense_approved_v1(
  p_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $
declare
  source_event public.d2f_event_outbox%rowtype;
  payload jsonb;
  tenant_context text;
  proposal_id uuid;
begin
  if exists (
    select 1 from public.d2f_event_inbox
    where consumer = 'd2f-financial.expense-accounting-proposal'
      and event_id = p_event_id and processed_at is not null
  ) then
    return jsonb_build_object('eventId', p_event_id, 'status', 'already_processed');
  end if;

  select * into source_event from public.d2f_event_outbox where event_id = p_event_id;
  if not found or source_event.event_type <> 'ExpenseApproved' then
    raise exception 'ExpenseApproved event not found';
  end if;

  payload := source_event.envelope -> 'payload';
  tenant_context := source_event.envelope #>> '{context,tenantId}';

  insert into public.d2f_financial_accounting_proposals (
    owner_key, tenant_id, source_type, source_id, source_event_id, currency, amount, proposal
  ) values (
    source_event.owner_key, tenant_context, 'ExpenseReport', payload ->> 'expenseReportId',
    source_event.event_id, payload ->> 'currency', (payload ->> 'approvedGross')::numeric,
    jsonb_build_object(
      'kind', 'employee_expense',
      'sourceNumber', payload ->> 'reportNumber',
      'status', 'requires_validation',
      'reimbursementStatus', 'not_requested'
    )
  )
  on conflict (owner_key, source_type, source_id) do nothing
  returning id into proposal_id;

  insert into public.d2f_event_inbox (consumer, event_id, event_type, processed_at, attempts)
  values ('d2f-financial.expense-accounting-proposal', source_event.event_id, source_event.event_type, now(), 1)
  on conflict (consumer, event_id) do update
    set processed_at = excluded.processed_at, attempts = public.d2f_event_inbox.attempts + 1, last_error = null;

  return jsonb_build_object(
    'eventId', p_event_id,
    'status', 'proposal_created',
    'expenseReportId', payload ->> 'expenseReportId',
    'accountingProposalId', proposal_id
  );
end;
$;

revoke all on function public.d2f_financial_consume_invoice_issued_v1(uuid) from public;
grant execute on function public.d2f_financial_consume_invoice_issued_v1(uuid) to service_role;
revoke all on function public.d2f_financial_consume_expense_approved_v1(uuid) from public;
grant execute on function public.d2f_financial_consume_expense_approved_v1(uuid) to service_role;

revoke all on function public.d2f_expense_submit_v1(text, uuid, text, text, uuid, uuid) from public;
revoke all on function public.d2f_expense_decide_v1(text, uuid, text, text, text, text, uuid, uuid) from public;
grant execute on function public.d2f_expense_submit_v1(text, uuid, text, text, uuid, uuid) to service_role;
grant execute on function public.d2f_expense_decide_v1(text, uuid, text, text, text, text, uuid, uuid) to service_role;

comment on table public.d2f_financial_invoice_projections is
  'Rebuildable Financial projection of customer invoices owned by D2F Gestion.';
comment on table public.d2f_financial_accounting_proposals is
  'Controlled pre-accounting proposals; approval never means posting.';
comment on table public.d2f_expense_reports is
  'Authoritative D2F Expense aggregate root.';
comment on table public.d2f_expense_receipts is
  'Receipt provenance and integrity metadata; original bytes remain in protected object storage.';
