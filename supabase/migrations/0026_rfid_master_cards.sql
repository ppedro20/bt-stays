-- MODULE 26 - RFID MASTER CARDS
-- Master cards use 5-digit numeric IDs; they are always permanent and carry that ID as keycard/code.

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
  v_is_master boolean;
begin
  v_card_uid := nullif(trim(p_card_uid), '');
  if v_card_uid is null then
    raise exception 'missing_card_uid';
  end if;

  v_is_master := v_card_uid ~ '^[0-9]{5}$';
  v_permanent := coalesce(p_permanent, false);
  v_keycard := nullif(trim(p_keycard), '');

  if v_is_master then
    v_permanent := true;
    v_keycard := v_card_uid;
    v_code := v_card_uid;
    v_code_id := null;
  elsif v_permanent then
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