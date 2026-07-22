-- D2F Platform 3.3.15 — Country Pack versions are independent by pack family.
-- Publishing country.rs.platform must not supersede country.rs.expenses or a future
-- country.rs.financial pack. No threshold or local rule is enabled by this migration.
create or replace function public.d2f_publish_country_pack_v1(p_pack_version_id uuid, p_actor text)
returns public.d2f_country_pack_versions
language plpgsql security definer set search_path = public as $$
declare v_pack public.d2f_country_pack_versions; v_regulatory boolean; v_technical boolean; v_security boolean;
begin
  select * into v_pack from public.d2f_country_pack_versions where id=p_pack_version_id for update;
  if v_pack.id is null then raise exception 'Country Pack version not found'; end if;
  if trim(v_pack.regulatory_owner)='' or trim(v_pack.technical_owner)='' then raise exception 'Regulatory and technical owners are required'; end if;
  if v_pack.manifest='{}'::jsonb or v_pack.manifest_sha256='' then raise exception 'A hashed manifest is required'; end if;
  select exists(select 1 from public.d2f_country_pack_reviews where pack_version_id=v_pack.id and review_type='regulatory' and decision='approved') into v_regulatory;
  select exists(select 1 from public.d2f_country_pack_reviews where pack_version_id=v_pack.id and review_type='technical' and decision='approved') into v_technical;
  select exists(select 1 from public.d2f_country_pack_reviews where pack_version_id=v_pack.id and review_type='security' and decision='approved') into v_security;
  if not v_regulatory or not v_technical or not v_security then raise exception 'Regulatory, technical and security approvals are required'; end if;
  update public.d2f_country_pack_versions set status='superseded',updated_at=now()
    where pack_id=v_pack.pack_id and status='published' and id<>v_pack.id;
  update public.d2f_country_pack_versions set status='published',effective_from=coalesce(effective_from,now()),published_at=now(),updated_at=now(),created_by=coalesce(nullif(created_by,''),p_actor) where id=v_pack.id returning * into v_pack;
  return v_pack;
end $$;
revoke all on function public.d2f_publish_country_pack_v1(uuid,text) from public, anon, authenticated;
grant execute on function public.d2f_publish_country_pack_v1(uuid,text) to service_role;
