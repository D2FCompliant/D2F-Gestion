-- Chapters 16-18: canonical customer payment, settlement projection and Expense invariants.

alter table public.d2f_financial_invoice_projections
  add column if not exists source_aggregate_version bigint not null default 1,
  add column if not exists source_snapshot_sha256 text;

update public.d2f_financial_invoice_projections
set source_snapshot_sha256 = encode(digest(source_payload::text, 'sha256'), 'hex')
where source_snapshot_sha256 is null;

alter table public.d2f_financial_invoice_projections
  drop constraint if exists d2f_financial_invoice_snapshot_hash_chk;

alter table public.d2f_financial_invoice_projections
  alter column source_snapshot_sha256 set not null,
  add constraint d2f_financial_invoice_snapshot_hash_chk check (source_snapshot_sha256 ~ '^[a-f0-9]{64}$');

create table if not exists public.d2f_financial_customer_payment_projections (
  owner_key text not null,
  tenant_id text not null,
  payment_id text not null,
  source_event_id uuid not null unique,
  source_aggregate_version bigint not null,
  payment_date date not null,
  value_date date,
  amount numeric(20,6) not null check (amount > 0),
  currency char(3) not null,
  payment_method text not null,
  payment_reference text,
  direction text not null check (direction in ('in','out')),
  status text not null check (status in ('posted','cancelled')),
  source_payload jsonb not null,
  source_snapshot_sha256 text not null check (source_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  projected_at timestamptz not null default now(),
  primary key (owner_key, payment_id)
);

create table if not exists public.d2f_financial_settlement_projections (
  owner_key text not null,
  tenant_id text not null,
  settlement_id uuid not null,
  source_event_id uuid not null,
  payment_id text not null,
  invoice_id text not null,
  allocated_amount numeric(20,6) not null check (allocated_amount > 0),
  currency char(3) not null,
  allocation_type text not null check (allocation_type in ('payment','refund')),
  status text not null check (status in ('allocated','cancelled')),
  allocated_at timestamptz not null,
  projected_at timestamptz not null default now(),
  primary key (owner_key, settlement_id),
  unique (owner_key, payment_id, invoice_id, source_event_id)
);

alter table public.d2f_financial_customer_payment_projections enable row level security;
alter table public.d2f_financial_settlement_projections enable row level security;
revoke all on public.d2f_financial_customer_payment_projections, public.d2f_financial_settlement_projections from anon, authenticated;
grant all on public.d2f_financial_customer_payment_projections, public.d2f_financial_settlement_projections to service_role;

create or replace function public.d2f_register_customer_payment_v1(
  p_owner_key text, p_tenant_id text, p_payment_id text, p_invoice_id text, p_actor_id text,
  p_amount numeric, p_currency text, p_payment_date date, p_value_date date, p_method text,
  p_reference text, p_direction text, p_status text, p_notes text, p_idempotency_key text,
  p_event_id uuid, p_correlation_id uuid, p_settlement_id uuid
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  invoice_row public.d2f_records%rowtype; invoice_data jsonb; payment_data jsonb;
  event_envelope jsonb; existing_event uuid; tenant_uuid uuid; occurred_at timestamptz:=now();
  client_data jsonb:='{}'::jsonb; company_data jsonb:='{}'::jsonb; allocation_type text;
begin
  if length(coalesce(p_idempotency_key,'')) not between 16 and 200 then raise exception 'Invalid idempotency key'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Payment amount must be positive'; end if;
  if upper(coalesce(p_currency,'')) !~ '^[A-Z]{3}$' then raise exception 'Invalid payment currency'; end if;
  if p_direction not in ('in','out') or p_status not in ('posted','cancelled') then raise exception 'Invalid payment state'; end if;
  select event_id into existing_event from public.d2f_event_outbox where owner_key=p_owner_key and event_type='InvoicePaymentRegistered' and idempotency_key=p_idempotency_key;
  if found then select data into payment_data from public.d2f_records where owner_email=p_owner_key and entity='payments' and id=p_payment_id; return coalesce(payment_data,'{}'::jsonb)||jsonb_build_object('id',p_payment_id,'event_id',existing_event); end if;
  select * into invoice_row from public.d2f_records where owner_email=p_owner_key and entity='invoices' and id=p_invoice_id for share;
  if not found or lower(coalesce(invoice_row.status,invoice_row.data->>'status','draft'))<>'issued' then raise exception 'Payment requires an issued invoice'; end if;
  invoice_data:=invoice_row.data;
  if lower(coalesce(invoice_data->>'type','final'))='credit_note' then raise exception 'A customer payment cannot target a credit note'; end if;
  if upper(coalesce(invoice_data->>'currency','EUR'))<>upper(p_currency) then raise exception 'Payment and invoice currencies must match'; end if;
  select coalesce(data,'{}'::jsonb) into company_data from public.d2f_company where owner_email=p_owner_key;
  select coalesce(data,'{}'::jsonb) into client_data from public.d2f_records where owner_email=p_owner_key and entity='clients' and id=invoice_data->>'client_id';
  allocation_type:=case when p_direction='out' then 'refund' else 'payment' end;
  payment_data:=jsonb_build_object(
    'id',p_payment_id,'invoice_id',p_invoice_id,'date',p_payment_date,'value_date',p_value_date,
    'amount',p_amount,'currency',upper(p_currency),'method',p_method,'reference',p_reference,
    'direction',p_direction,'status',p_status,'notes',coalesce(p_notes,''),
    'allocations',jsonb_build_array(jsonb_build_object('settlement_id',p_settlement_id,'invoice_id',p_invoice_id,'amount',p_amount,'allocation_type',allocation_type,'status',case when p_status='cancelled' then 'cancelled' else 'allocated' end))
  );
  insert into public.d2f_records(id,owner_email,entity,search_text,status,document_date,parent_id,data,updated_at)
  values(p_payment_id,p_owner_key,'payments',concat_ws(' ',p_reference,p_method,p_invoice_id),p_status,p_payment_date,p_invoice_id,payment_data,occurred_at);
  if p_tenant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then tenant_uuid:=p_tenant_id::uuid; end if;
  event_envelope:=public.d2f_canonical_event_v1(
    p_event_id,'InvoicePaymentRegistered',1,occurred_at,'d2f-gestion','customer-payment-service','3.0.0',
    'CustomerPayment',p_payment_id,1,coalesce(nullif(p_tenant_id,''),p_owner_key),'user',p_actor_id,p_correlation_id,null,
    'https://schemas.d2fcompliant.org/events/customer-payment-registered.v1.schema.json',upper(coalesce(company_data->>'country','FR')),true,true,
    jsonb_build_object(
      'paymentId',p_payment_id,'paymentDate',p_payment_date,'valueDate',p_value_date,'amount',p_amount::text,'currency',upper(p_currency),
      'paymentMethod',p_method,'paymentReference',p_reference,'direction',p_direction,'status',p_status,
      'payer',jsonb_build_object('id',invoice_data->>'client_id','name',coalesce(client_data->>'name',invoice_data->>'client_name','Client')),
      'payee',jsonb_build_object('id',null,'name',coalesce(company_data->>'legal_name',company_data->>'name',p_owner_key)),
      'allocations',jsonb_build_array(jsonb_build_object('settlementId',p_settlement_id,'invoiceId',p_invoice_id,'allocatedAmount',p_amount::text,'allocationType',allocation_type,'status',case when p_status='cancelled' then 'cancelled' else 'allocated' end))
    ));
  insert into public.d2f_event_outbox(event_id,owner_key,tenant_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,correlation_id,idempotency_key,occurred_at,envelope)
  values(p_event_id,p_owner_key,tenant_uuid,'InvoicePaymentRegistered',1,'payment',p_payment_id,1,p_correlation_id,p_idempotency_key,occurred_at,event_envelope);
  return payment_data||jsonb_build_object('event_id',p_event_id);
end $$;

create or replace function public.d2f_financial_consume_customer_payment_v1(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare source_event public.d2f_event_outbox%rowtype; payload jsonb; tenant_context text; allocation jsonb;
begin
  if exists(select 1 from public.d2f_event_inbox where consumer='d2f-financial.customer-payment-projection' and event_id=p_event_id and processed_at is not null) then return jsonb_build_object('eventId',p_event_id,'status','already_processed'); end if;
  select * into source_event from public.d2f_event_outbox where event_id=p_event_id;
  if not found or source_event.event_type<>'InvoicePaymentRegistered' then raise exception 'InvoicePaymentRegistered event not found'; end if;
  payload:=source_event.envelope->'payload'; tenant_context:=source_event.envelope#>>'{context,tenantId}';
  insert into public.d2f_financial_customer_payment_projections(owner_key,tenant_id,payment_id,source_event_id,source_aggregate_version,payment_date,value_date,amount,currency,payment_method,payment_reference,direction,status,source_payload,source_snapshot_sha256)
  values(source_event.owner_key,tenant_context,payload->>'paymentId',source_event.event_id,source_event.aggregate_version,(payload->>'paymentDate')::date,nullif(payload->>'valueDate','')::date,(payload->>'amount')::numeric,payload->>'currency',payload->>'paymentMethod',payload->>'paymentReference',payload->>'direction',payload->>'status',payload,encode(digest(payload::text,'sha256'),'hex'));
  for allocation in select * from jsonb_array_elements(payload->'allocations') loop
    insert into public.d2f_financial_settlement_projections(owner_key,tenant_id,settlement_id,source_event_id,payment_id,invoice_id,allocated_amount,currency,allocation_type,status,allocated_at)
    values(source_event.owner_key,tenant_context,(allocation->>'settlementId')::uuid,source_event.event_id,payload->>'paymentId',allocation->>'invoiceId',(allocation->>'allocatedAmount')::numeric,payload->>'currency',allocation->>'allocationType',allocation->>'status',source_event.occurred_at);
  end loop;
  insert into public.d2f_event_inbox(consumer,event_id,event_type,processed_at,attempts) values('d2f-financial.customer-payment-projection',source_event.event_id,source_event.event_type,now(),1)
  on conflict(consumer,event_id) do update set processed_at=excluded.processed_at,attempts=public.d2f_event_inbox.attempts+1,last_error=null;
  return jsonb_build_object('eventId',p_event_id,'status','projected','paymentId',payload->>'paymentId');
end $$;

alter table public.d2f_expense_lines
  add column if not exists payment_method text not null default 'personal_card',
  add column if not exists original_currency char(3),
  add column if not exists original_gross_amount numeric(20,6),
  add column if not exists personal_amount numeric(20,6) not null default 0 check (personal_amount>=0),
  add column if not exists reimbursable_amount numeric(20,6),
  add column if not exists policy_version text,
  add column if not exists policy_evaluated_at timestamptz;

alter table public.d2f_expense_reports
  add column if not exists claimed_amount numeric(20,6) not null default 0,
  add column if not exists eligible_amount numeric(20,6) not null default 0,
  add column if not exists rejected_amount numeric(20,6) not null default 0,
  add column if not exists personal_amount numeric(20,6) not null default 0,
  add column if not exists reimbursable_amount numeric(20,6) not null default 0,
  add column if not exists advance_amount numeric(20,6) not null default 0,
  add column if not exists reimbursed_amount numeric(20,6) not null default 0,
  add column if not exists remaining_amount numeric(20,6) not null default 0,
  add column if not exists reimbursement_status text not null default 'not_requested',
  add column if not exists accounting_status text not null default 'not_requested';

create or replace function public.d2f_enforce_expense_segregation_v1()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status in ('approved','rejected') and new.approver_id is not null and new.approver_id=new.claimant_id then
    raise exception 'The claimant cannot be the sole approver of their own expense report';
  end if;
  return new;
end $$;

drop trigger if exists d2f_expense_segregation_v1 on public.d2f_expense_reports;
create trigger d2f_expense_segregation_v1 before insert or update on public.d2f_expense_reports
for each row execute function public.d2f_enforce_expense_segregation_v1();

revoke all on function public.d2f_register_customer_payment_v1(text,text,text,text,text,numeric,text,date,date,text,text,text,text,text,text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.d2f_register_customer_payment_v1(text,text,text,text,text,numeric,text,date,date,text,text,text,text,text,text,uuid,uuid,uuid) to service_role;
revoke all on function public.d2f_financial_consume_customer_payment_v1(uuid) from public,anon,authenticated;
grant execute on function public.d2f_financial_consume_customer_payment_v1(uuid) to service_role;

comment on table public.d2f_financial_customer_payment_projections is 'Rebuildable Financial projection; D2F Gestion remains authoritative for the Customer Payment.';
comment on table public.d2f_financial_settlement_projections is 'Settlement projection distinct from Customer Payment and Bank Reconciliation.';
