-- MODULE 25 - RFID FUNCTION VARIABLE CONFLICT FIX
-- Ensure column references win when names overlap with output params.

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
#variable_conflict use_column
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
#variable_conflict use_column
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
