-- D2F Platform v3.3.18 — governed Serbian Financial Country Pack candidate.
-- This migration creates a review candidate only. It activates no tax rate,
-- threshold, account mapping or reporting decision and never publishes it.
do $d2f$
declare
  v_manifest jsonb := $manifest$
{
  "schemaVersion": "1.0",
  "packId": "country.rs.financial",
  "country": "RS",
  "module": "financial",
  "version": "2026.1.0",
  "lifecycleStatus": "regulatory_review",
  "automaticPublication": false,
  "currency": "RSD",
  "languages": [
    "sr",
    "en"
  ],
  "capabilities": {
    "accountingMappings": "human_validation_required",
    "taxRules": "human_validation_required",
    "reportingMappings": "human_validation_required",
    "receivableMatching": "platform_baseline_only"
  },
  "financial": {
    "chartOfAccounts": {
      "status": "human_validation_required",
      "mappings": []
    },
    "vat": {
      "status": "human_validation_required",
      "rates": [],
      "exemptions": []
    },
    "reporting": {
      "status": "human_validation_required",
      "declarations": [],
      "calendar": []
    }
  },
  "unresolvedDecisions": [
    "Validate the applicable Serbian chart-of-accounts mappings for the target entity type.",
    "Validate VAT treatments, rates, exemptions and effective dates before enabling local decisions.",
    "Validate declaration mappings, filing calendar and evidence requirements."
  ],
  "sources": [
    {
      "id": "rs-accounting-law",
      "title": "Accounting law",
      "authority": "Ministry of Finance of the Republic of Serbia",
      "url": "https://mfin.gov.rs/propisi/-zakon-o-racunovodstvu-sluzbeni-glasnik-rs-br-732019"
    },
    {
      "id": "rs-chart-of-accounts",
      "title": "Chart of accounts regulation for companies, cooperatives and entrepreneurs",
      "authority": "Ministry of Finance of the Republic of Serbia",
      "url": "https://mfin.gov.rs/sr/propisi-1/pravilnik-o-kontnom-okviru-i-sadrzini-racuna-u-kontnom-okviru-za-privredna-drustva-zadruge-i-preduzetnike-sluzbeni-glasnik-rs-br-892020-1"
    },
    {
      "id": "rs-vat-law",
      "title": "Value Added Tax Law",
      "authority": "Tax Administration of the Republic of Serbia",
      "url": "https://purs.gov.rs/preduzetnici/pregled-propisa/zakoni/202/zakon-o-porezu-na-dodatu-vrednost.html"
    },
    {
      "id": "rs-vat-secondary-legislation",
      "title": "VAT subordinate legislation",
      "authority": "Tax Administration of the Republic of Serbia",
      "url": "https://www.purs.gov.rs/fizicka-lica/pdv/podzakonska-akta.html"
    }
  ],
  "governance": {
    "regulatoryApprovalRequired": true,
    "technicalApprovalRequired": true,
    "securityApprovalRequired": true,
    "evidenceVerificationRequired": true
  }
}
  $manifest$::jsonb;
  v_pack_version_id uuid;
begin
  insert into public.d2f_country_pack_versions (
    pack_id, country, pack_version, status, regulatory_owner,
    technical_owner, manifest, manifest_sha256, created_by
  )
  values (
    'country.rs.financial', 'RS', '2026.1.0', 'regulatory_review', '',
    'D2F Platform Engineering', v_manifest,
    encode(digest(v_manifest::text, 'sha256'), 'hex'),
    'D2F Platform 3.3.18 migration'
  )
  on conflict (pack_id, pack_version) do update
  set
    manifest = case when public.d2f_country_pack_versions.status = 'published' then public.d2f_country_pack_versions.manifest else excluded.manifest end,
    manifest_sha256 = case when public.d2f_country_pack_versions.status = 'published' then public.d2f_country_pack_versions.manifest_sha256 else excluded.manifest_sha256 end,
    technical_owner = case when trim(public.d2f_country_pack_versions.technical_owner) = '' then excluded.technical_owner else public.d2f_country_pack_versions.technical_owner end,
    updated_at = now()
  returning id into v_pack_version_id;

  insert into public.d2f_country_pack_evidence (
    pack_version_id, evidence_type, source_uri, authority, sha256,
    verification_status, metadata
  )
  select v_pack_version_id, source.evidence_type, source.source_uri, source.authority,
    encode(digest(source.source_uri || '|2026-07-23', 'sha256'), 'hex'), 'pending',
    jsonb_build_object('sourceId', source.source_id, 'title', source.title, 'hashScope', 'reference_metadata')
  from (values
    ('official_source_reference', 'https://mfin.gov.rs/propisi/-zakon-o-racunovodstvu-sluzbeni-glasnik-rs-br-732019', 'Ministry of Finance of the Republic of Serbia', 'rs-accounting-law', 'Accounting law'),
    ('official_source_reference', 'https://mfin.gov.rs/sr/propisi-1/pravilnik-o-kontnom-okviru-i-sadrzini-racuna-u-kontnom-okviru-za-privredna-drustva-zadruge-i-preduzetnike-sluzbeni-glasnik-rs-br-892020-1', 'Ministry of Finance of the Republic of Serbia', 'rs-chart-of-accounts', 'Chart of accounts regulation for companies, cooperatives and entrepreneurs'),
    ('official_source_reference', 'https://purs.gov.rs/preduzetnici/pregled-propisa/zakoni/202/zakon-o-porezu-na-dodatu-vrednost.html', 'Tax Administration of the Republic of Serbia', 'rs-vat-law', 'Value Added Tax Law'),
    ('official_source_reference', 'https://www.purs.gov.rs/fizicka-lica/pdv/podzakonska-akta.html', 'Tax Administration of the Republic of Serbia', 'rs-vat-secondary-legislation', 'VAT subordinate legislation')
  ) as source(evidence_type, source_uri, authority, source_id, title)
  where not exists (
    select 1 from public.d2f_country_pack_evidence existing
    where existing.pack_version_id = v_pack_version_id and existing.source_uri = source.source_uri
  );
end
$d2f$;
