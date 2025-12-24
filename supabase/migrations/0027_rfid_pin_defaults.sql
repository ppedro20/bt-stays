-- MODULE 27 - RFID PIN DEFAULTS
-- RFID cards are permanent; default PIN equals card UID unless specified.

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

  v_permanent := true;
  v_keycard := nullif(trim(p_keycard), '');
  if v_keycard is null then
    v_keycard := v_card_uid;
  end if;

  v_code := v_keycard;
  v_code_id := null;

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

update public.rfid_cards
set permanent = true
where permanent is distinct from true;

update public.rfid_cards
set keycard = card_uid
where keycard is null or length(trim(keycard)) = 0;
