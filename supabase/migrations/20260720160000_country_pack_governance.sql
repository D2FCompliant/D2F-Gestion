-- D2F Platform — auditable Country Pack qualification and publication workflow.
create table if not exists public.d2f_country_pack_versions (
  id uuid primary key default gen_random_uuid(),
  pack_id text not null,
  country text not null check (country ~ '^[A-Z]{2}$'),
  pack_version text not null,
  status text not null default 'draft' check (status in ('draft','evidence_collection','regulatory_review','technical_review','security_review','approved','scheduled','published','suspended','superseded','revoked','rejected')),
  regulatory_owner text not null default '',
  technical_owner text not null default '',
  manifest jsonb not null default '{}'::jsonb,
  manifest_sha256 text not null default '',
  effective_from timestamptz,
  effective_to timestamptz,
  published_at timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pack_id, pack_version),
  check (effective_to is null or effective_from is null or effective_to > effective_from)
);

create table if not exists public.d2f_country_pack_evidence (
  id uuid primary key default gen_random_uuid(),
  pack_version_id uuid not null references public.d2f_country_pack_versions(id) on delete cascade,
  evidence_type text not null,
  source_uri text not null,
  authority text not null default '',
  effective_date date,
  sha256 text not null,
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','rejected','expired')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.d2f_country_pack_reviews (
  id uuid primary key default gen_random_uuid(),
  pack_version_id uuid not null references public.d2f_country_pack_versions(id) on delete cascade,
  review_type text not null check (review_type in ('regulatory','technical','security')),
  reviewer text not null,
  decision text not null check (decision in ('approved','rejected','changes_requested')),
  notes text not null default '',
  evidence_snapshot_hash text not null,
  decided_at timestamptz not null default now()
);

create index if not exists d2f_country_pack_current_idx on public.d2f_country_pack_versions(country,status,effective_from desc);
create index if not exists d2f_country_pack_evidence_version_idx on public.d2f_country_pack_evidence(pack_version_id);
create index if not exists d2f_country_pack_reviews_version_idx on public.d2f_country_pack_reviews(pack_version_id,review_type,decided_at desc);

alter table public.d2f_country_pack_versions enable row level security;
alter table public.d2f_country_pack_evidence enable row level security;
alter table public.d2f_country_pack_reviews enable row level security;
revoke all on public.d2f_country_pack_versions, public.d2f_country_pack_evidence, public.d2f_country_pack_reviews from anon, authenticated;
grant all on public.d2f_country_pack_versions, public.d2f_country_pack_evidence, public.d2f_country_pack_reviews to service_role;

create or replace function public.d2f_publish_country_pack_v1(p_pack_version_id uuid, p_actor text)
returns public.d2f_country_pack_versions
language plpgsql security definer set search_path = public as $$
declare v_pack public.d2f_country_pack_versions; v_regulatory boolean; v_technical boolean;
begin
  select * into v_pack from public.d2f_country_pack_versions where id=p_pack_version_id for update;
  if v_pack.id is null then raise exception 'Country Pack version not found'; end if;
  if trim(v_pack.regulatory_owner)='' or trim(v_pack.technical_owner)='' then raise exception 'Regulatory and technical owners are required'; end if;
  if v_pack.manifest='{}'::jsonb or v_pack.manifest_sha256='' then raise exception 'A hashed manifest is required'; end if;
  select exists(select 1 from public.d2f_country_pack_reviews where pack_version_id=v_pack.id and review_type='regulatory' and decision='approved') into v_regulatory;
  select exists(select 1 from public.d2f_country_pack_reviews where pack_version_id=v_pack.id and review_type='technical' and decision='approved') into v_technical;
  if not v_regulatory or not v_technical then raise exception 'Regulatory and technical approvals are required'; end if;
  update public.d2f_country_pack_versions set status='superseded',updated_at=now() where country=v_pack.country and status='published' and id<>v_pack.id;
  update public.d2f_country_pack_versions set status='published',effective_from=coalesce(effective_from,now()),published_at=now(),updated_at=now(),created_by=coalesce(nullif(created_by,''),p_actor) where id=v_pack.id returning * into v_pack;
  return v_pack;
end $$;
revoke all on function public.d2f_publish_country_pack_v1(uuid,text) from public, anon, authenticated;
grant execute on function public.d2f_publish_country_pack_v1(uuid,text) to service_role;
