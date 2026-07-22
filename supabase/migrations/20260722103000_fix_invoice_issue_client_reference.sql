-- Corrects the production issue RPC: the PL/pgSQL variable previously collided
-- with d2f_client_pa_preferences.client_id and blocked invoice/credit-note issuance.
-- CREATE OR REPLACE is idempotent and preserves the atomic record + outbox boundary.

create or replace function public.d2f_issue_invoice_v1(
  p_owner_key text,
  p_tenant_id text,
  p_invoice_id text,
  p_actor_id text,
  p_idempotency_key text,
  p_event_id uuid,
  p_correlation_id uuid,
  p_outbound_pa_connector_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_row public.d2f_records%rowtype;
  invoice_data jsonb;
  company_data jsonb := '{}'::jsonb;
  client_data jsonb := '{}'::jsonb;
  invoice_lines jsonb;
  event_envelope jsonb;
  existing_event_id uuid;
  issued_at timestamptz := now();
  issue_date text;
  invoice_number text;
  invoice_kind text;
  number_prefix text;
  sequence_number integer;
  v_client_id text;
  selected_outbound_pa uuid;
  outbound_selection_source text := 'none';
  inbound_pa uuid;
  tenant_uuid uuid;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 16 or length(p_idempotency_key) > 200 then
    raise exception 'Idempotency-Key invalide';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_key || ':invoice-issue', 0));

  select event_id into existing_event_id
  from public.d2f_event_outbox
  where owner_key = p_owner_key
    and event_type = 'InvoiceIssued'
    and idempotency_key = p_idempotency_key;

  if found then
    select * into invoice_row
    from public.d2f_records
    where owner_email = p_owner_key and entity = 'invoices' and id = p_invoice_id;

    if not found then raise exception 'Facture introuvable'; end if;
    return invoice_row.data || jsonb_build_object('id', invoice_row.id, 'event_id', existing_event_id);
  end if;

  select * into invoice_row
  from public.d2f_records
  where owner_email = p_owner_key and entity = 'invoices' and id = p_invoice_id
  for update;

  if not found then raise exception 'Facture introuvable'; end if;
  if lower(coalesce(invoice_row.status, invoice_row.data ->> 'status', 'draft')) <> 'draft' then
    raise exception 'Seule une facture brouillon peut être émise';
  end if;

  invoice_data := invoice_row.data;
  invoice_lines := coalesce(invoice_data -> 'lines', '[]'::jsonb);
  if jsonb_typeof(invoice_lines) <> 'array' or jsonb_array_length(invoice_lines) = 0 then
    raise exception 'La facture doit contenir au moins une ligne';
  end if;

  v_client_id := nullif(invoice_data ->> 'client_id', '');
  if v_client_id is not null then
    select coalesce(data, '{}'::jsonb) into client_data
    from public.d2f_records
    where owner_email = p_owner_key and entity = 'clients' and id = v_client_id;
    client_data := coalesce(client_data, '{}'::jsonb);
  end if;

  select coalesce(data, '{}'::jsonb) into company_data
  from public.d2f_company where owner_email = p_owner_key;
  company_data := coalesce(company_data, '{}'::jsonb);

  select id into inbound_pa
  from public.d2f_pa_connectors
  where owner_key = p_owner_key
    and enabled and qualified and is_default_inbound
    and direction in ('inbound', 'both')
  limit 1;

  if p_outbound_pa_connector_id is not null then
    select id into selected_outbound_pa
    from public.d2f_pa_connectors
    where id = p_outbound_pa_connector_id and owner_key = p_owner_key
      and enabled and qualified and direction in ('outbound', 'both');
    if selected_outbound_pa is null then
      raise exception 'La PA d’émission demandée n’est pas autorisée pour cette entreprise';
    end if;
    outbound_selection_source := 'invoice';
  elsif v_client_id is not null then
    select connector.id into selected_outbound_pa
    from public.d2f_client_pa_preferences preference
    join public.d2f_pa_connectors connector on connector.id = preference.outbound_connector_id
    where preference.owner_key = p_owner_key and preference.client_id = v_client_id
      and preference.valid_from <= current_date
      and connector.owner_key = p_owner_key and connector.enabled and connector.qualified
      and connector.direction in ('outbound', 'both')
    limit 1;
    if selected_outbound_pa is not null then outbound_selection_source := 'client'; end if;
  end if;

  if selected_outbound_pa is null then
    select id into selected_outbound_pa
    from public.d2f_pa_connectors
    where owner_key = p_owner_key and enabled and qualified and is_default_outbound
      and direction in ('outbound', 'both')
    limit 1;
    if selected_outbound_pa is not null then outbound_selection_source := 'default'; end if;
  end if;

  invoice_kind := lower(coalesce(invoice_data ->> 'type', 'final'));
  number_prefix := case when invoice_kind = 'credit_note' then 'AV' else 'F' end;
  invoice_number := nullif(invoice_data ->> 'invoice_number', '');
  if invoice_number is null then
    select count(*) + 1 into sequence_number
    from public.d2f_records
    where owner_email = p_owner_key and entity = 'invoices' and status = 'issued'
      and (lower(coalesce(data ->> 'type', 'final')) = 'credit_note') = (invoice_kind = 'credit_note');
    invoice_number := number_prefix || extract(year from issued_at)::integer || '-' || lpad(sequence_number::text, 4, '0');
  end if;

  issue_date := coalesce(nullif(invoice_data ->> 'date', ''), issued_at::date::text);
  invoice_data := invoice_data || jsonb_build_object(
    'status', 'issued',
    'invoice_number', invoice_number,
    'issued_at', issued_at,
    'outbound_pa_connector_id', selected_outbound_pa,
    'outbound_pa_selection_source', outbound_selection_source
  );

  update public.d2f_records
  set data = invoice_data,
      status = 'issued',
      document_number = invoice_number,
      document_date = issue_date::date,
      updated_at = issued_at
  where id = invoice_row.id and owner_email = p_owner_key and entity = 'invoices';

  if p_tenant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    tenant_uuid := p_tenant_id::uuid;
  end if;

  event_envelope := public.d2f_canonical_event_v1(
    p_event_id, 'InvoiceIssued', 1, issued_at,
    'd2f-gestion', 'invoice-service', '3.3.14',
    'CustomerInvoice', p_invoice_id, 1,
    coalesce(nullif(p_tenant_id, ''), p_owner_key),
    'user', p_actor_id, p_correlation_id, null,
    'https://schemas.d2fcompliant.org/events/invoice-issued.v1.schema.json',
    upper(coalesce(nullif(company_data ->> 'country', ''), 'FR')),
    true, true,
    jsonb_build_object(
      'invoiceId', p_invoice_id,
      'invoiceNumber', invoice_number,
      'invoiceType', invoice_kind,
      'issueDate', issue_date,
      'dueDate', nullif(invoice_data ->> 'due_date', ''),
      'currency', upper(coalesce(nullif(invoice_data ->> 'currency', ''), 'EUR')),
      'seller', jsonb_build_object(
        'id', null,
        'name', coalesce(nullif(company_data ->> 'legal_name', ''), nullif(company_data ->> 'name', ''), p_owner_key),
        'legalId', nullif(company_data ->> 'legal_id', ''),
        'vatId', nullif(company_data ->> 'vat_id', ''),
        'country', upper(coalesce(nullif(company_data ->> 'country', ''), 'FR'))
      ),
      'buyer', jsonb_build_object(
        'id', v_client_id,
        'name', coalesce(nullif(client_data ->> 'name', ''), nullif(invoice_data ->> 'client_name', ''), 'Client'),
        'legalId', nullif(client_data ->> 'legal_id', ''),
        'vatId', nullif(client_data ->> 'vat_id', ''),
        'country', upper(coalesce(nullif(client_data ->> 'country', ''), 'FR'))
      ),
      'totals', jsonb_build_object(
        'net', coalesce(invoice_data ->> 'total_ht', '0'),
        'tax', coalesce(invoice_data ->> 'total_tva', '0'),
        'gross', coalesce(invoice_data ->> 'total_ttc', '0')
      ),
      'sourceQuoteId', nullif(invoice_data ->> 'quote_id', ''),
      'sourceInvoiceId', nullif(invoice_data ->> 'source_invoice_id', ''),
      'routing', jsonb_build_object(
        'receptionPaConnectorId', inbound_pa,
        'outboundPaConnectorId', selected_outbound_pa,
        'outboundPaSelectionSource', outbound_selection_source
      ),
      'lines', (
        select jsonb_agg(jsonb_build_object(
          'lineId', coalesce(nullif(line ->> 'id', ''), ordinality::text),
          'description', coalesce(nullif(line ->> 'description', ''), nullif(line ->> 'name', ''), 'Ligne'),
          'quantity', coalesce(line ->> 'quantity', '1'),
          'unitCode', coalesce(nullif(line ->> 'unit_code', ''), 'C62'),
          'unitPriceNet', coalesce(line ->> 'unit_price_ht', '0'),
          'taxCategory', nullif(line ->> 'tax_category', ''),
          'taxRate', coalesce(line ->> 'tva_percent', '0'),
          'lineNet', coalesce(line ->> 'total_ht', '0')
        ) order by ordinality)
        from jsonb_array_elements(invoice_lines) with ordinality as item(line, ordinality)
      )
    )
  );

  insert into public.d2f_event_outbox (
    event_id, owner_key, tenant_id, event_type, event_version,
    aggregate_type, aggregate_id, aggregate_version, correlation_id,
    idempotency_key, occurred_at, envelope
  ) values (
    p_event_id, p_owner_key, tenant_uuid, 'InvoiceIssued', 1,
    'invoice', p_invoice_id, 1, p_correlation_id,
    p_idempotency_key, issued_at, event_envelope
  );

  return invoice_data || jsonb_build_object('id', p_invoice_id, 'event_id', p_event_id);
end;
$$;

revoke all on function public.d2f_issue_invoice_v1(text, text, text, text, text, uuid, uuid, uuid) from public;
grant execute on function public.d2f_issue_invoice_v1(text, text, text, text, text, uuid, uuid, uuid) to service_role;

comment on function public.d2f_issue_invoice_v1(text, text, text, text, text, uuid, uuid, uuid) is
  'Atomically issues invoices and credit notes; client PA routing uses an unambiguous v_client_id variable (D2F Platform 3.3.14).';
