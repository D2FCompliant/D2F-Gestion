create extension if not exists pgcrypto;

create table if not exists public.d2f_audit_events (
  owner_email text not null,
  seq bigint not null check (seq > 0),
  event_time timestamptz not null,
  actor text not null,
  action text not null,
  entity_type text not null default '',
  entity_id text not null default '',
  prev_hash text,
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  hmac text check (hmac is null or hmac ~ '^[0-9a-f]{64}$'),
  canonical_text text not null,
  event jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_email, seq),
  unique (owner_email, hash)
);

create index if not exists d2f_audit_events_owner_time_idx
  on public.d2f_audit_events(owner_email, event_time desc);
create index if not exists d2f_audit_events_owner_action_idx
  on public.d2f_audit_events(owner_email, action);

create or replace function public.d2f_audit_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  previous_seq bigint;
  previous_hash text;
  computed_hash text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'D2F audit events are append-only';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.owner_email, 0));
  select seq, hash
    into previous_seq, previous_hash
    from public.d2f_audit_events
    where owner_email = new.owner_email
    order by seq desc
    limit 1;

  if previous_seq is null then
    if new.seq <> 1 or new.prev_hash is not null then
      raise exception 'D2F audit chain must start at sequence 1';
    end if;
  elsif new.seq <> previous_seq + 1 or new.prev_hash is distinct from previous_hash then
    raise exception 'D2F audit chain continuity error';
  end if;

  computed_hash := encode(extensions.digest(convert_to(new.canonical_text, 'UTF8'), 'sha256'::text), 'hex');
  if computed_hash is distinct from new.hash then
    raise exception 'D2F audit hash mismatch';
  end if;
  if new.event ->> 'hash' is distinct from new.hash then
    raise exception 'D2F audit event/hash mismatch';
  end if;
  if (new.event ->> 'seq')::bigint is distinct from new.seq then
    raise exception 'D2F audit event/sequence mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists d2f_audit_guard_trigger on public.d2f_audit_events;
create trigger d2f_audit_guard_trigger
before insert or update or delete on public.d2f_audit_events
for each row execute function public.d2f_audit_guard();

alter table public.d2f_audit_events enable row level security;

revoke all on public.d2f_audit_events from anon, authenticated;
grant select, insert on public.d2f_audit_events to service_role;
revoke all on function public.d2f_audit_guard() from public, anon, authenticated;
grant execute on function public.d2f_audit_guard() to service_role;

comment on table public.d2f_audit_events is
  'Piste d’audit D2F append-only, séquencée et chaînée par SHA-256';
