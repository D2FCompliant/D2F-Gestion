-- D2F Platform 3.3.8 — make legacy safe platform baselines explicitly manual.
-- No regulatory threshold is enabled by this compatibility migration.

update public.d2f_country_pack_versions
set manifest = jsonb_set(manifest, '{automaticPublication}', 'false'::jsonb, true),
    manifest_sha256 = encode(digest(jsonb_set(manifest, '{automaticPublication}', 'false'::jsonb, true)::text, 'sha256'), 'hex'),
    updated_at = now()
where pack_id like 'country.%.platform'
  and not (manifest ? 'automaticPublication')
  and manifest #>> '{expense,status}' = 'production'
  and manifest #>> '{expense,legalThresholds,status}' = 'human_validation_required';
