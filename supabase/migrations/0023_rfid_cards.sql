-- MODULE 23 - RFID CARDS + LOGS
-- Manage RFID cards mapped to access codes and store usage logs.

create table if not exists public.rfid_cards (
  id uuid primary key default gen_random_uuid(),
  card_uid text not null unique,
  access_code_id uuid not null references public.access_codes(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rfid_cards_access_code_id_idx
on public.rfid_cards (access_code_id);

create table if not exists public.rfid_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  card_id uuid null references public.rfid_cards(id) on delete set null,
  card_uid text not null,
  access_code_id uuid null references public.access_codes(id),
  keycard text null,
  granted boolean not null,
  reason text not null
);

create index if not exists rfid_logs_created_at_idx
on public.rfid_logs (created_at desc);
create index if not exists rfid_logs_card_uid_idx
on public.rfid_logs (card_uid);

alter table public.rfid_cards enable row level security;
alter table public.rfid_logs enable row level security;

create policy rfid_cards_all_service_role
on public.rfid_cards
for all
to service_role
using (true)
with check (true);

create policy rfid_logs_all_service_role
on public.rfid_logs
for all
to service_role
using (true)
with check (true);

-- Admin read models (service_role only, via Edge Functions).
create or replace view public.admin_rfid_cards as
select
  rc.id as card_id,
  rc.card_uid,
  rc.access_code_id,
  ac.code_plaintext,
  ac.code_status,
  ac.valid_until,
  rc.created_at,
  rc.updated_at
from public.rfid_cards rc
join public.admin_codes ac on ac.code_id = rc.access_code_id;

grant select on table public.admin_rfid_cards to service_role;

create or replace view public.admin_rfid_logs as
select
  l.id::text as log_id,
  l.created_at,
  l.card_id,
  l.card_uid,
  l.access_code_id,
  l.keycard,
  l.granted,
  l.reason
from public.rfid_logs l
order by l.created_at desc
limit 200;

grant select on table public.admin_rfid_logs to service_role;

alter view if exists public.admin_rfid_cards set (security_invoker = true);
alter view if exists public.admin_rfid_logs set (security_invoker = true);

create or replace function public.assign_rfid_code(
  p_card_uid text,
  p_code text,
  p_actor_id uuid default null
)
returns table (
  card_id uuid,
  card_uid text,
  access_code_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card_uid text;
  v_code text;
  v_code_id uuid;
begin
  v_card_uid := nullif(trim(p_card_uid), '');
  v_code := nullif(trim(p_code), '');

  if v_card_uid is null then
    raise exception 'missing_card_uid';
  end if;
  if v_code is null or v_code !~ '^[0-9]{6}$' then
    raise exception 'invalid_code_format';
  end if;

  select id into v_code_id
  from public.access_codes
  where code_plaintext = v_code
  limit 1;

  if v_code_id is null then
    raise exception 'code_not_found';
  end if;

  insert into public.rfid_cards (card_uid, access_code_id)
  values (v_card_uid, v_code_id)
  on conflict (card_uid)
  do update set
    access_code_id = excluded.access_code_id,
    updated_at = now()
  returning id into card_id;

  card_uid := v_card_uid;
  access_code_id := v_code_id;

  insert into public.events (event_type, entity_type, entity_id, actor_type, actor_id, details)
  values (
    'rfid_card_assigned',
    'rfid_card',
    card_id,
    'admin',
    p_actor_id,
    jsonb_build_object('card_uid', v_card_uid, 'access_code_id', v_code_id, 'code', v_code)
  );

  return next;
end;
$$;

revoke all on function public.assign_rfid_code(text, text, uuid) from public;
grant execute on function public.assign_rfid_code(text, text, uuid) to service_role;

create or replace function public.consume_rfid(
  p_card_uid text,
  p_ip inet default null
)
returns table (
  granted boolean,
  reason text,
  access_code_id uuid,
  valid_until timestamptz,
  used_at timestamptz,
  card_id uuid,
  card_uid text,
  keycard text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card_uid text;
  v_card public.rfid_cards%rowtype;
  v_code text;
  v_result record;
begin
  v_card_uid := nullif(trim(p_card_uid), '');
  if v_card_uid is null then
    granted := false;
    reason := 'invalid_card_uid';
    card_uid := p_card_uid;
    insert into public.rfid_logs (card_id, card_uid, access_code_id, keycard, granted, reason)
    values (null, coalesce(v_card_uid, ''), null, null, false, reason);
    return next;
    return;
  end if;

  select * into v_card
  from public.rfid_cards
  where card_uid = v_card_uid
  limit 1;

  if not found then
    granted := false;
    reason := 'card_not_found';
    card_uid := v_card_uid;
    insert into public.rfid_logs (card_id, card_uid, access_code_id, keycard, granted, reason)
    values (null, v_card_uid, null, null, false, reason);
    return next;
    return;
  end if;

  select code_plaintext into v_code
  from public.access_codes
  where id = v_card.access_code_id;

  if v_code is null then
    granted := false;
    reason := 'code_not_found';
    card_id := v_card.id;
    card_uid := v_card_uid;
    access_code_id := v_card.access_code_id;
    insert into public.rfid_logs (card_id, card_uid, access_code_id, keycard, granted, reason)
    values (v_card.id, v_card_uid, v_card.access_code_id, null, false, reason);
    return next;
    return;
  end if;

  select * into v_result
  from public.consume_code(v_code, p_ip)
  limit 1;

  granted := v_result.granted;
  reason := v_result.reason;
  access_code_id := v_result.access_code_id;
  valid_until := v_result.valid_until;
  used_at := v_result.used_at;
  card_id := v_card.id;
  card_uid := v_card_uid;
  keycard := v_code;

  insert into public.rfid_logs (card_id, card_uid, access_code_id, keycard, granted, reason)
  values (v_card.id, v_card_uid, access_code_id, v_code, granted, reason);

  return next;
end;
$$;

revoke all on function public.consume_rfid(text, inet) from public;
grant execute on function public.consume_rfid(text, inet) to service_role;
