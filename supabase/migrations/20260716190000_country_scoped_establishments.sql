alter table public.d2f_tenants
  add column if not exists identifier_type text not null default 'NATIONAL_ID';

alter table public.d2f_tenants
  drop constraint if exists d2f_tenants_company_identifier_key;

create unique index if not exists d2f_tenants_country_company_identifier_idx
  on public.d2f_tenants (upper(country), upper(company_identifier));

update public.d2f_tenants
set identifier_type = case upper(country)
  when 'FR' then 'SIRET'
  when 'RS' then 'PIB'
  when 'IT' then 'PARTITA_IVA_OR_CF'
  when 'ES' then 'NIF'
  else 'NATIONAL_ID'
end;

comment on column public.d2f_tenants.company_identifier is
  'Identifiant de l’établissement facturant, unique à l’intérieur du pays (SIRET en France)';

comment on column public.d2f_tenants.identifier_type is
  'Type national de l’identifiant d’établissement : SIRET, PIB, Partita IVA/Codice Fiscale, NIF ou autre';
