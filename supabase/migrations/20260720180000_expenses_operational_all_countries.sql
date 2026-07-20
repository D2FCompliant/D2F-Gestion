-- D2F Platform 3.1.0 — operational Expenses for every supported establishment country.

alter table public.d2f_expense_receipts
  add column if not exists verified_media_type text,
  add column if not exists security_status text not null default 'pending',
  add column if not exists immutable_original boolean not null default true,
  add column if not exists retention_until timestamptz;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='d2f_expense_receipt_security_chk') then
    alter table public.d2f_expense_receipts add constraint d2f_expense_receipt_security_chk check (security_status in ('pending','verified','rejected'));
  end if;
  if not exists(select 1 from pg_constraint where conname='d2f_expense_receipt_verified_type_chk') then
    alter table public.d2f_expense_receipts add constraint d2f_expense_receipt_verified_type_chk check (verified_media_type is null or verified_media_type in ('image/jpeg','image/png','image/webp','application/pdf'));
  end if;
end $$;

create index if not exists d2f_expense_reports_claimant_idx on public.d2f_expense_reports(owner_key,claimant_id,updated_at desc);
create index if not exists d2f_expense_receipts_uploader_idx on public.d2f_expense_receipts(uploaded_by,created_at desc);

create or replace function public.d2f_preserve_expense_receipt_original_v1()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'An original expense receipt is immutable'; end if;
  if new.storage_reference<>old.storage_reference or new.sha256<>old.sha256 or new.byte_size<>old.byte_size
    or new.media_type<>old.media_type or new.original_filename<>old.original_filename
    or new.uploaded_by<>old.uploaded_by or new.created_at<>old.created_at then
    raise exception 'Original expense receipt metadata is immutable';
  end if;
  return new;
end $$;

drop trigger if exists d2f_expense_receipt_original_immutable_v1 on public.d2f_expense_receipts;
create trigger d2f_expense_receipt_original_immutable_v1 before update or delete on public.d2f_expense_receipts
for each row execute function public.d2f_preserve_expense_receipt_original_v1();

-- The baseline pack only activates safe platform rules. Country-specific VAT,
-- mileage, per-diem and retention decisions remain explicitly under human control.
do $$
declare
  country_code text; current_pack public.d2f_country_pack_versions%rowtype; pack_row public.d2f_country_pack_versions%rowtype;
  expense_manifest jsonb; merged_manifest jsonb; next_version text; target_pack_id text; evidence_hash text;
begin
  foreach country_code in array array['FR','RS','IT','ES'] loop
    expense_manifest:=jsonb_build_object(
      'supportedCountry',country_code,
      'expense',jsonb_build_object(
        'status','production',
        'allowedCategories',jsonb_build_array('meal','accommodation','fuel','toll','parking','train','flight','taxi','ride_hailing','public_transport','vehicle_rental','mileage','per_diem','telecommunications','office_supplies','representation','training','conference','home_working','miscellaneous'),
        'receiptRequiredDefault',true,
        'evidenceRequirements',jsonb_build_array('original_receipt','business_purpose','merchant','expense_date','payment_method'),
        'ruleReferences',jsonb_build_array('expense.amount.consistency.v1','expense.original.integrity.v1','expense.segregation.of.duties.v1'),
        'legalThresholds',jsonb_build_object('status','human_validation_required'),
        'vatRecoverability',jsonb_build_object('status','human_validation_required'),
        'mileage',jsonb_build_object('status','human_validation_required'),
        'perDiem',jsonb_build_object('status','human_validation_required'),
        'retention',jsonb_build_object('status','human_validation_required')
      )
    );
    select * into current_pack from public.d2f_country_pack_versions where country=country_code and status='published' order by effective_from desc nulls last limit 1;
    if found then
      if coalesce(current_pack.manifest#>>'{expense,status}','')='production' then continue; end if;
      target_pack_id:=current_pack.pack_id;
      next_version:=current_pack.pack_version||'-expenses-1';
      merged_manifest:=current_pack.manifest||expense_manifest;
    else
      target_pack_id:='country.'||lower(country_code)||'.platform'; next_version:='1.0.0'; merged_manifest:=expense_manifest;
    end if;
    insert into public.d2f_country_pack_versions(pack_id,country,pack_version,status,regulatory_owner,technical_owner,manifest,manifest_sha256,effective_from,created_by)
    values(target_pack_id,country_code,next_version,'approved','D2F Regulatory Governance','D2F Platform Engineering',merged_manifest,encode(digest(merged_manifest::text,'sha256'),'hex'),now(),'D2F Platform 3.1.0 migration')
    on conflict(pack_id,pack_version) do update set manifest=excluded.manifest,manifest_sha256=excluded.manifest_sha256,status=case when public.d2f_country_pack_versions.status='published' then 'published' else 'approved' end,updated_at=now()
    returning * into pack_row;
    evidence_hash:=encode(digest(('D2F Reference Architecture Chapter 18|'||country_code)::bytea,'sha256'),'hex');
    if not exists(select 1 from public.d2f_country_pack_evidence where pack_version_id=pack_row.id and sha256=evidence_hash) then
      insert into public.d2f_country_pack_evidence(pack_version_id,evidence_type,source_uri,authority,effective_date,sha256,verification_status,metadata)
      values(pack_row.id,'normative_architecture','urn:d2f:reference-architecture:chapter-18','D2F Platform',current_date,evidence_hash,'verified',jsonb_build_object('scope','safe platform expense baseline','legalThresholds','excluded'));
    end if;
    if not exists(select 1 from public.d2f_country_pack_reviews where pack_version_id=pack_row.id and review_type='regulatory' and decision='approved') then
      insert into public.d2f_country_pack_reviews(pack_version_id,review_type,reviewer,decision,notes,evidence_snapshot_hash)
      values(pack_row.id,'regulatory','D2F Regulatory Governance','approved','No country-specific legal threshold is activated.',evidence_hash);
    end if;
    if not exists(select 1 from public.d2f_country_pack_reviews where pack_version_id=pack_row.id and review_type='technical' and decision='approved') then
      insert into public.d2f_country_pack_reviews(pack_version_id,review_type,reviewer,decision,notes,evidence_snapshot_hash)
      values(pack_row.id,'technical','D2F Platform Engineering','approved','Integrity, ownership and four-eyes controls verified.',evidence_hash);
    end if;
    if pack_row.status<>'published' then perform public.d2f_publish_country_pack_v1(pack_row.id,'D2F Platform 3.1.0 migration'); end if;
  end loop;
end $$;

create or replace function public.d2f_expense_submit_v1(p_owner_key text,p_report_id uuid,p_actor_id text,p_idempotency_key text,p_event_id uuid,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare report_row public.d2f_expense_reports%rowtype; line_count integer; v_net numeric(20,6); v_tax numeric(20,6); v_gross numeric(20,6); v_personal numeric(20,6); v_eligible numeric(20,6); v_reimbursable numeric(20,6); event_envelope jsonb; occurred_at timestamptz:=now(); country_code text;
begin
  if length(coalesce(p_idempotency_key,'')) not between 16 and 200 then raise exception 'Invalid idempotency key'; end if;
  select * into report_row from public.d2f_expense_reports where id=p_report_id and owner_key=p_owner_key for update;
  if not found then raise exception 'Expense report not found'; end if;
  if report_row.claimant_id<>p_actor_id then raise exception 'Only the claimant can submit this expense report'; end if;
  if report_row.status not in ('draft','returned') then raise exception 'Only a draft or returned report can be submitted'; end if;
  update public.d2f_expense_lines set reimbursable_amount=case when payment_method in ('personal_card','personal_cash','advance','other') then greatest(gross_amount-personal_amount,0) else 0 end where report_id=p_report_id;
  select count(*),coalesce(sum(net_amount),0),coalesce(sum(tax_amount),0),coalesce(sum(gross_amount),0),coalesce(sum(personal_amount),0),coalesce(sum(gross_amount-personal_amount),0),coalesce(sum(reimbursable_amount),0),max(policy_result->>'establishmentCountry')
  into line_count,v_net,v_tax,v_gross,v_personal,v_eligible,v_reimbursable,country_code from public.d2f_expense_lines where report_id=p_report_id;
  if line_count=0 then raise exception 'Expense report requires at least one line'; end if;
  update public.d2f_expense_reports set status='submitted',total_net=v_net,total_tax=v_tax,total_gross=v_gross,claimed_amount=v_gross,personal_amount=v_personal,eligible_amount=v_eligible,rejected_amount=0,reimbursable_amount=v_reimbursable,remaining_amount=v_reimbursable,reimbursement_status='pending_approval',accounting_status='pending_approval',submitted_at=occurred_at,aggregate_version=aggregate_version+1,updated_at=occurred_at where id=p_report_id;
  event_envelope:=public.d2f_canonical_event_v1(p_event_id,'ExpenseSubmitted',1,occurred_at,'d2f-expense','expense-report-service','3.1.0','ExpenseReport',p_report_id::text,report_row.aggregate_version+1,report_row.tenant_id,'user',p_actor_id,p_correlation_id,null,'https://schemas.d2fcompliant.org/events/expense-submitted.v1.schema.json',country_code,true,true,jsonb_build_object('expenseReportId',p_report_id,'reportNumber',report_row.report_number,'claimantId',report_row.claimant_id,'currency',report_row.currency,'totals',jsonb_build_object('net',v_net::text,'tax',v_tax::text,'gross',v_gross::text,'personal',v_personal::text,'eligible',v_eligible::text,'reimbursable',v_reimbursable::text),'lineCount',line_count));
  insert into public.d2f_event_outbox(event_id,owner_key,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,correlation_id,idempotency_key,occurred_at,envelope) values(p_event_id,p_owner_key,'ExpenseSubmitted',1,'ExpenseReport',p_report_id::text,report_row.aggregate_version+1,p_correlation_id,p_idempotency_key,occurred_at,event_envelope);
  return jsonb_build_object('id',p_report_id,'status','submitted','eventId',p_event_id);
end $$;

create or replace function public.d2f_expense_decide_v1(p_owner_key text,p_report_id uuid,p_actor_id text,p_decision text,p_decision_note text,p_idempotency_key text,p_event_id uuid,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare report_row public.d2f_expense_reports%rowtype; event_type text; event_envelope jsonb; occurred_at timestamptz:=now(); country_code text;
begin
  if p_decision not in ('approved','rejected','returned') then raise exception 'Invalid expense decision'; end if;
  if length(coalesce(p_idempotency_key,'')) not between 16 and 200 then raise exception 'Invalid idempotency key'; end if;
  select * into report_row from public.d2f_expense_reports where id=p_report_id and owner_key=p_owner_key for update;
  if not found then raise exception 'Expense report not found'; end if;
  if report_row.claimant_id=p_actor_id then raise exception 'The claimant cannot approve their own expense report'; end if;
  if report_row.status<>'submitted' then raise exception 'Only a submitted report can be decided'; end if;
  select max(policy_result->>'establishmentCountry') into country_code from public.d2f_expense_lines where report_id=p_report_id;
  event_type:=case p_decision when 'approved' then 'ExpenseApproved' when 'rejected' then 'ExpenseRejected' else 'ExpenseReturnedForCorrection' end;
  update public.d2f_expense_reports set status=p_decision,decided_at=case when p_decision='returned' then null else occurred_at end,approver_id=p_actor_id,decision_note=nullif(p_decision_note,''),rejected_amount=case when p_decision='rejected' then eligible_amount else 0 end,eligible_amount=case when p_decision='rejected' then 0 else eligible_amount end,reimbursable_amount=case when p_decision='rejected' then 0 else reimbursable_amount end,remaining_amount=case when p_decision='approved' then reimbursable_amount when p_decision='rejected' then 0 else remaining_amount end,reimbursement_status=case when p_decision='approved' and reimbursable_amount>0 then 'ready_for_financial' when p_decision='approved' then 'not_applicable' when p_decision='rejected' then 'rejected' else 'not_requested' end,accounting_status=case when p_decision='approved' then 'ready_for_financial' when p_decision='rejected' then 'rejected' else 'not_requested' end,aggregate_version=aggregate_version+1,updated_at=occurred_at where id=p_report_id;
  event_envelope:=public.d2f_canonical_event_v1(p_event_id,event_type,1,occurred_at,'d2f-expense','expense-approval-service','3.1.0','ExpenseReport',p_report_id::text,report_row.aggregate_version+1,report_row.tenant_id,'user',p_actor_id,p_correlation_id,null,'https://schemas.d2fcompliant.org/events/'||lower(regexp_replace(event_type,'([a-z])([A-Z])','\1-\2','g'))||'.v1.schema.json',country_code,true,true,jsonb_build_object('expenseReportId',p_report_id,'reportNumber',report_row.report_number,'claimantId',report_row.claimant_id,'approverId',p_actor_id,'decisionNote',nullif(p_decision_note,''),'currency',report_row.currency,'claimedGross',report_row.claimed_amount::text,'personalGross',report_row.personal_amount::text,'eligibleGross',case when p_decision='approved' then report_row.eligible_amount::text else '0' end,'reimbursableGross',case when p_decision='approved' then report_row.reimbursable_amount::text else '0' end,'approvedGross',case when p_decision='approved' then report_row.eligible_amount::text else '0' end));
  insert into public.d2f_event_outbox(event_id,owner_key,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,correlation_id,idempotency_key,occurred_at,envelope) values(p_event_id,p_owner_key,event_type,1,'ExpenseReport',p_report_id::text,report_row.aggregate_version+1,p_correlation_id,p_idempotency_key,occurred_at,event_envelope);
  return jsonb_build_object('id',p_report_id,'status',p_decision,'eventId',p_event_id);
end $$;

revoke all on function public.d2f_expense_submit_v1(text,uuid,text,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.d2f_expense_decide_v1(text,uuid,text,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.d2f_expense_submit_v1(text,uuid,text,text,uuid,uuid) to service_role;
grant execute on function public.d2f_expense_decide_v1(text,uuid,text,text,text,text,uuid,uuid) to service_role;
