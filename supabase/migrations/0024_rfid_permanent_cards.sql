-- MODULE 24 - RFID PERMANENT CARDS
-- Allow permanent cards without access code expiry and manage keycard label.

alter table public.rfid_cards
  add column if not exists permanent boolean not null default false,
  add column if not exists keycard text null;

alter table public.rfid_cards
  alter column access_code_id drop not null;

drop view if exists public.admin_rfid_cards;
create view public.admin_rfid_cards as
select
  rc.id as card_id,
  rc.card_uid,
  rc.permanent,
  rc.keycard,
  rc.access_code_id,
  ac.code_plaintext,
  ac.code_status,
  ac.valid_until,
  rc.created_at,
  rc.updated_at
from public.rfid_cards rc
left join public.admin_codes ac on ac.code_id = rc.access_code_id;

grant select on table public.admin_rfid_cards to service_role;
alter view if exists public.admin_rfid_cards set (security_invoker = true);

create or replace function public.upsert_rfid_card(
  p_card_uid text,
  p_code text default null,
  p_permanent boolean default false,
  p_keycard text default null,
  p_actor_id uuid default null
)
returns table (
  card_id uuid,
  card_uid text,
  access_code_id uuid,
  permanent boolean,
  keycard text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card_uid text;
  v_code text;
  v_code_id uuid;
  v_permanent boolean;
  v_keycard text;
begin
  v_card_uid := nullif(trim(p_card_uid), '');
  if v_card_uid is null then
    raise exception 'missing_card_uid';
  end if;

  v_permanent := coalesce(p_permanent, false);
  v_keycard := nullif(trim(p_keycard), '');

  if v_permanent then
    v_code_id := null;
  else
    v_code := nullif(trim(p_code), '');
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
  end if;

  insert into public.rfid_cards (card_uid, access_code_id, permanent, keycard)
  values (v_card_uid, v_code_id, v_permanent, v_keycard)
  on conflict (card_uid)
  do update set
    access_code_id = excluded.access_code_id,
    permanent = excluded.permanent,
    keycard = excluded.keycard,
    updated_at = now()
  returning id into card_id;

  card_uid := v_card_uid;
  access_code_id := v_code_id;
  permanent := v_permanent;
  keycard := v_keycard;

  insert into public.events (event_type, entity_type, entity_id, actor_type, actor_id, details)
  values (
    'rfid_card_upserted',
    'rfid_card',
    card_id,
    'admin',
    p_actor_id,
    jsonb_build_object(
      'card_uid', v_card_uid,
      'access_code_id', v_code_id,
      'code', v_code,
      'permanent', v_permanent,
      'keycard', v_keycard
    )
  );

  return next;
end;
$$;

revoke all on function public.upsert_rfid_card(text, text, boolean, text, uuid) from public;
grant execute on function public.upsert_rfid_card(text, text, boolean, text, uuid) to service_role;

create or replace function public.delete_rfid_card(
  p_card_uid text default null,
  p_card_id uuid default null,
  p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_uid text;
begin
  if p_card_id is not null then
    select id, card_uid into v_id, v_uid
    from public.rfid_cards
    where id = p_card_id;
  elsif p_card_uid is not null then
    select id, card_uid into v_id, v_uid
    from public.rfid_cards
    where card_uid = trim(p_card_uid);
  else
    raise exception 'missing_card_identifier';
  end if;

  if v_id is null then
    raise exception 'card_not_found';
  end if;

  delete from public.rfid_cards where id = v_id;

  insert into public.events (event_type, entity_type, entity_id, actor_type, actor_id, details)
  values (
    'rfid_card_deleted',
    'rfid_card',
    v_id,
    'admin',
    p_actor_id,
    jsonb_build_object('card_uid', v_uid)
  );
end;
$$;

revoke all on function public.delete_rfid_card(text, uuid, uuid) from public;
grant execute on function public.delete_rfid_card(text, uuid, uuid) to service_role;

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

  if v_card.permanent then
    granted := true;
    reason := 'ok';
    access_code_id := null;
    valid_until := null;
    used_at := null;
    card_id := v_card.id;
    card_uid := v_card_uid;
    keycard := v_card.keycard;

    insert into public.rfid_logs (card_id, card_uid, access_code_id, keycard, granted, reason)
    values (v_card.id, v_card_uid, null, v_card.keycard, true, reason);
    return next;
    return;
  end if;

  if v_card.access_code_id is null then
    granted := false;
    reason := 'code_not_found';
    card_id := v_card.id;
    card_uid := v_card_uid;
    insert into public.rfid_logs (card_id, card_uid, access_code_id, keycard, granted, reason)
    values (v_card.id, v_card_uid, null, null, false, reason);
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
