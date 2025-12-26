-- MODULE 28 - RFID REMOTE ACCESS + BLOCKING
-- Add per-card blocking and a remote open queue for devices to poll.

alter table public.rfid_cards
  add column if not exists blocked boolean not null default false;

create table if not exists public.rfid_remote_actions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  card_id uuid not null references public.rfid_cards(id) on delete cascade,
  card_uid text not null,
  action text not null check (action in ('open')),
  status text not null check (status in ('pending', 'executed', 'failed')),
  device_id text null,
  requested_by uuid null references public.admins(user_id) on delete set null,
  executed_at timestamptz null,
  executed_by_device text null,
  error text null
);

create index if not exists rfid_remote_actions_status_idx
  on public.rfid_remote_actions (status, created_at);

alter table public.rfid_remote_actions enable row level security;

create policy rfid_remote_actions_all_service_role
  on public.rfid_remote_actions
  for all
  to service_role
  using (true)
  with check (true);

drop view if exists public.admin_rfid_cards;
create view public.admin_rfid_cards as
select
  rc.id as card_id,
  rc.card_uid,
  rc.permanent,
  rc.keycard,
  rc.blocked,
  rc.access_code_id,
  ac.code_plaintext,
  ac.code_status,
  ac.valid_until,
  rc.created_at,
  rc.updated_at,
  (
    select max(l.created_at)
    from public.rfid_logs l
    where l.card_id = rc.id
      and l.granted = true
  ) as last_granted_at
from public.rfid_cards rc
left join public.admin_codes ac on ac.code_id = rc.access_code_id;

grant select on table public.admin_rfid_cards to service_role;
alter view if exists public.admin_rfid_cards set (security_invoker = true);

create or replace function public.request_rfid_remote_action(
  p_card_uid text,
  p_action text,
  p_actor_id uuid default null
)
returns table (
  action_id uuid,
  card_id uuid,
  card_uid text,
  action text,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card_uid text;
  v_action text;
  v_status text;
  v_card public.rfid_cards%rowtype;
begin
  v_card_uid := nullif(trim(p_card_uid), '');
  if v_card_uid is null then
    raise exception 'missing_card_uid';
  end if;

  v_action := lower(nullif(trim(p_action), ''));
  if v_action is null then
    raise exception 'missing_action';
  end if;

  select * into v_card
  from public.rfid_cards
  where card_uid = v_card_uid
  limit 1;

  if not found then
    raise exception 'card_not_found';
  end if;

  if v_action = 'block' then
    update public.rfid_cards
    set blocked = true,
        updated_at = now()
    where id = v_card.id;
    v_status := 'updated';
    action_id := null;
  elsif v_action = 'unblock' then
    update public.rfid_cards
    set blocked = false,
        updated_at = now()
    where id = v_card.id;
    v_status := 'updated';
    action_id := null;
  elsif v_action = 'open' then
    insert into public.rfid_remote_actions (card_id, card_uid, action, status, requested_by)
    values (v_card.id, v_card_uid, 'open', 'pending', p_actor_id)
    returning id into action_id;
    v_status := 'pending';
  else
    raise exception 'invalid_action';
  end if;

  card_id := v_card.id;
  card_uid := v_card_uid;
  action := v_action;
  status := v_status;

  insert into public.events (event_type, entity_type, entity_id, actor_type, actor_id, details)
  values (
    'rfid_remote_action_requested',
    'rfid_card',
    v_card.id,
    'admin',
    p_actor_id,
    jsonb_build_object(
      'card_uid', v_card_uid,
      'action', v_action,
      'status', v_status,
      'action_id', action_id
    )
  );

  return next;
end;
$$;

revoke all on function public.request_rfid_remote_action(text, text, uuid) from public;
grant execute on function public.request_rfid_remote_action(text, text, uuid) to service_role;

create or replace function public.claim_rfid_remote_action(
  p_device_id text default null
)
returns table (
  action_id uuid,
  card_id uuid,
  card_uid text,
  action text,
  keycard text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action record;
  v_keycard text;
begin
  with next_action as (
    select id
    from public.rfid_remote_actions
    where status = 'pending'
      and (device_id is null or device_id = p_device_id)
    order by created_at
    limit 1
    for update skip locked
  )
  update public.rfid_remote_actions
  set status = 'executed',
      executed_at = now(),
      executed_by_device = p_device_id
  where id in (select id from next_action)
  returning id, card_id, card_uid, action into v_action;

  if v_action.id is null then
    return;
  end if;

  select keycard into v_keycard
  from public.rfid_cards
  where id = v_action.card_id;

  if v_action.action = 'open' then
    insert into public.rfid_logs (card_id, card_uid, access_code_id, keycard, granted, reason)
    values (v_action.card_id, v_action.card_uid, null, v_keycard, true, 'remote_open');
  end if;

  insert into public.events (event_type, entity_type, entity_id, actor_type, actor_id, details)
  values (
    'rfid_remote_action_executed',
    'rfid_card',
    v_action.card_id,
    'device',
    null,
    jsonb_build_object(
      'card_uid', v_action.card_uid,
      'action', v_action.action,
      'device_id', p_device_id
    )
  );

  action_id := v_action.id;
  card_id := v_action.card_id;
  card_uid := v_action.card_uid;
  action := v_action.action;
  keycard := v_keycard;

  return next;
end;
$$;

revoke all on function public.claim_rfid_remote_action(text) from public;
grant execute on function public.claim_rfid_remote_action(text) to service_role;

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

  if v_card.blocked then
    granted := false;
    reason := 'card_blocked';
    card_id := v_card.id;
    card_uid := v_card_uid;
    insert into public.rfid_logs (card_id, card_uid, access_code_id, keycard, granted, reason)
    values (v_card.id, v_card_uid, null, null, false, reason);
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
