-- D2F Platform 3.4.0 - travel-order workflow candidates for every supported country.
-- Existing published packs remain effective until these candidates pass governance.
do $d2f$
declare
  c text;
  current_row public.d2f_country_pack_versions%rowtype;
  candidate_id uuid;
  v_source_uri text;
  v_authority_name text;
  workflow jsonb;
  expense_manifest jsonb;
  additional_categories jsonb := '["equipment","software","subscriptions","professional_services","rent","utilities","insurance","bank_fees"]'::jsonb;
  next_manifest jsonb;
begin
  foreach c in array array['RS','FR','IT','ES'] loop
    select * into current_row from public.d2f_country_pack_versions
      where country=c and (manifest->>'module'='expenses' or pack_id like '%.expenses')
      order by created_at desc limit 1;
    if not found then continue; end if;
    v_source_uri:=case c
      when 'RS' then 'https://webappcenter.nbs.rs/ExchangeRateWebApp/ExchangeRate/IndexByDate?isSearchExecuted=false'
      when 'FR' then 'https://www.urssaf.fr/accueil/employeur/beneficier-exonerations/frais-professionnels.html'
      when 'IT' then 'https://www.normattiva.it/uri-res/N2Ls?urn%3Anir%3Astato%3Alegge%3A1986%3B917~art51='
      else 'https://www.boe.es/buscar/pdf/2007/BOE-A-2007-6820-consolidado.pdf' end;
    v_authority_name:=case c when 'RS' then 'National Bank of Serbia' when 'FR' then 'URSSAF' when 'IT' then 'Normattiva' else 'AEAT / BOE' end;
    workflow:=jsonb_build_object(
      'documentTypes',jsonb_build_array('company_expense','travel_order'),
      'travelOrder',jsonb_build_object(
        'priorOrderRequired',true,
        'settlementRequired',true,
        'missionReportRequired',true,
        'businessNecessityRequired',true,
        'requiredFields',jsonb_build_array('orderNumber','orderDate','traveler','destinationCountry','destinationCity','purpose','departureAt','returnAt','transportMode','route'),
        'accountantExport',true,
        'bankSupportingFile',c='RS'
      ),
      'exchangeRate',jsonb_build_object(
        'freezeAtValidation',true,
        'source',case when c='RS' then 'NBS' else 'ECB_OR_LOCAL_OFFICIAL_SOURCE' end,
        'sourceUri',case when c='RS' then v_source_uri else 'https://data.ecb.europa.eu/key-figures/ecb-interest-rates-and-exchange-rates/exchange-rates' end,
        'manualConfirmationRequired',true
      )
    );
    expense_manifest:=coalesce(current_row.manifest #> '{expense}',current_row.manifest #> '{capabilities,expense}','{}'::jsonb);
    expense_manifest:=jsonb_set(expense_manifest,'{workflowProfiles}',workflow,true);
    expense_manifest:=jsonb_set(expense_manifest,'{allowedCategories}',coalesce(expense_manifest->'allowedCategories','[]'::jsonb) || additional_categories,true);
    next_manifest:=jsonb_set(current_row.manifest,'{expense}',expense_manifest,true)
      || jsonb_build_object('version','2026.2.0','lifecycleStatus','regulatory_review','automaticPublication',false);
    insert into public.d2f_country_pack_versions(pack_id,country,pack_version,status,regulatory_owner,technical_owner,manifest,manifest_sha256,created_by)
    values('country.'||lower(c)||'.expenses',c,'2026.2.0','regulatory_review','', 'D2F Platform Engineering',next_manifest,encode(digest(next_manifest::text,'sha256'),'hex'),'D2F Platform 3.4.0 migration')
    on conflict(pack_id,pack_version) do update set manifest=case when public.d2f_country_pack_versions.status='published' then public.d2f_country_pack_versions.manifest else excluded.manifest end,
      manifest_sha256=case when public.d2f_country_pack_versions.status='published' then public.d2f_country_pack_versions.manifest_sha256 else excluded.manifest_sha256 end,updated_at=now()
    returning id into candidate_id;
    insert into public.d2f_country_pack_evidence(pack_version_id,evidence_type,source_uri,authority,sha256,verification_status,metadata)
    select candidate_id,'official_source_reference',v_source_uri,v_authority_name,encode(digest(v_source_uri||'|2026-07-23','sha256'),'hex'),'pending',
      jsonb_build_object('scope',case when c='RS' then 'validation exchange rate' else 'travel expense legal source' end)
    where not exists(select 1 from public.d2f_country_pack_evidence where pack_version_id=candidate_id and d2f_country_pack_evidence.source_uri=v_source_uri);
    if c <> 'RS' then
      insert into public.d2f_country_pack_evidence(pack_version_id,evidence_type,source_uri,authority,sha256,verification_status,metadata)
      select candidate_id,'official_source_reference','https://data.ecb.europa.eu/key-figures/ecb-interest-rates-and-exchange-rates/exchange-rates','European Central Bank',
        encode(digest('https://data.ecb.europa.eu/key-figures/ecb-interest-rates-and-exchange-rates/exchange-rates|2026-07-23','sha256'),'hex'),'pending',jsonb_build_object('scope','validation exchange rate')
      where not exists(select 1 from public.d2f_country_pack_evidence where pack_version_id=candidate_id and source_uri='https://data.ecb.europa.eu/key-figures/ecb-interest-rates-and-exchange-rates/exchange-rates');
    end if;
  end loop;
end
$d2f$;
