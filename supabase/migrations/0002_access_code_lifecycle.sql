-- MODULE 2 — ACCESS CODE LIFECYCLE (CORE)
-- Goal: access_code as the central, controlled entity with deterministic expiry and no invalid transitions.

-- Explicit, deterministic state (derived; expiry is time-based, not a stored mutation).
create or replace view public.access_codes_with_state as
select
  c.*,
  case
    when c.revoked_at is not null then 'revoked'
    when c.used_at is not null then 'used'
    when now() > c.valid_until then 'expired'
    else 'issued'
  end as state
from public.access_codes c;

grant select on table public.access_codes_with_state to service_role;

-- Enforce transitions and immutability even for service_role.
create or replace function public.enforce_access_code_lifecycle()
returns trigger
language plpgsql
as $$
declare
  v_now timestamptz := now();
begin
  if tg_op = 'INSERT' then
    -- issued is the only valid initial state
    if new.used_at is not null then
      raise exception 'invalid_transition_initial_used';
    end if;
    if new.revoked_at is not null then
      raise exception 'invalid_transition_initial_revoked';
    end if;
    if new.valid_until <= new.valid_from then
      raise exception 'invalid_validity_window';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Immutable fields
    if new.payment_id <> old.payment_id then raise exception 'immutable_field_payment_id'; end if;
    if new.code_hash <> old.code_hash then raise exception 'immutable_field_code_hash'; end if;
    if new.code_last2 <> old.code_last2 then raise exception 'immutable_field_code_last2'; end if;
    if new.issued_at <> old.issued_at then raise exception 'immutable_field_issued_at'; end if;
    if new.valid_from <> old.valid_from then raise exception 'immutable_field_valid_from'; end if;
    if new.valid_until <> old.valid_until then raise exception 'immutable_field_valid_until'; end if;

    -- No resurrection: cannot clear terminal markers
    if old.used_at is not null and new.used_at is null then
      raise exception 'invalid_transition_used_to_issued';
    end if;
    if old.revoked_at is not null and new.revoked_at is null then
      raise exception 'invalid_transition_revoked_to_issued';
    end if;

    -- No state skipping / dual terminal states
    if new.used_at is not null and new.revoked_at is not null then
      raise exception 'invalid_transition_used_and_revoked';
    end if;

    -- Terminal states are terminal
    if old.used_at is not null then
      if new.used_at <> old.used_at then raise exception 'invalid_transition_used_mutation'; end if;
      if new.revoked_at is not null then raise exception 'invalid_transition_used_to_revoked'; end if;
      return new;
    end if;

    if old.revoked_at is not null then
      if new.revoked_at <> old.revoked_at then raise exception 'invalid_transition_revoked_mutation'; end if;
      if new.used_at is not null then raise exception 'invalid_transition_revoked_to_used'; end if;
      return new;
    end if;

    -- From issued: only allow -> used or -> revoked, but never if expired.
    if v_now > old.valid_until then
      -- issued -> expired is automatic (time based); explicit mutations are forbidden when expired.
      if new.used_at is not null or new.revoked_at is not null then
        raise exception 'invalid_transition_expired_mutation';
      end if;
      return new;
    end if;

    -- issued -> used
    if old.used_at is null and new.used_at is not null then
      if new.used_at < old.issued_at then raise exception 'invalid_used_at_before_issued'; end if;
      return new;
    end if;

    -- issued -> revoked
    if old.revoked_at is null and new.revoked_at is not null then
      if new.revoked_at < old.issued_at then raise exception 'invalid_revoked_at_before_issued'; end if;
      return new;
    end if;

    -- No-op update on issued is ok (but avoid allowing other changes)
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_access_codes_lifecycle on public.access_codes;
create trigger trg_access_codes_lifecycle
before insert or update on public.access_codes
for each row execute function public.enforce_access_code_lifecycle();

-- Prevent delete (no resurrection / auditability).
create or replace function public.prevent_access_code_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'access_codes_delete_forbidden';
end;
$$;

drop trigger if exists trg_access_codes_no_delete on public.access_codes;
create trigger trg_access_codes_no_delete
before delete on public.access_codes
for each row execute function public.prevent_access_code_delete();

-- Tighten server RPC: enforce numeric 6 digits input (no client-side trust).
create or replace function public.consume_code(p_code text, p_ip inet default null)
returns table (
  granted boolean,
  reason text,
  access_code_id uuid,
  payment_id uuid,
  valid_until timestamptz,
  used_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.access_codes%rowtype;
  v_now timestamptz := now();
begin
  if p_code is null or trim(p_code) !~ '^[0-9]{6}$' then
    granted := false;
    reason := 'invalid_format';
    return next;
    return;
  end if;

  select *
    into v_code
  from public.access_codes
  where code_hash = public.sha256_text(trim(p_code))
  for update;

  if not found then
    insert into public.events (event_type, entity_type, entity_id, actor_type, ip, details)
    values ('access_code_rejected', 'access_code', null, 'user', p_ip, jsonb_build_object('reason', 'not_found'));
    granted := false;
    reason := 'not_found';
    return next;
    return;
  end if;

  access_code_id := v_code.id;
  payment_id := v_code.payment_id;
  valid_until := v_code.valid_until;
  used_at := v_code.used_at;

  if v_code.revoked_at is not null then
    insert into public.events (event_type, entity_type, entity_id, actor_type, ip, details)
    values ('access_code_rejected', 'access_code', v_code.id, 'user', p_ip, jsonb_build_object('reason', 'revoked'));
    granted := false;
    reason := 'revoked';
    return next;
    return;
  end if;

  if v_code.used_at is not null then
    insert into public.events (event_type, entity_type, entity_id, actor_type, ip, details)
    values ('access_code_rejected', 'access_code', v_code.id, 'user', p_ip, jsonb_build_object('reason', 'already_used'));
    granted := false;
    reason := 'already_used';
    return next;
    return;
  end if;

  if v_now > v_code.valid_until then
    insert into public.events (event_type, entity_type, entity_id, actor_type, ip, details)
    values ('access_code_rejected', 'access_code', v_code.id, 'user', p_ip, jsonb_build_object('reason', 'expired'));
    granted := false;
    reason := 'expired';
    return next;
    return;
  end if;

  update public.access_codes
  set used_at = v_now
  where id = v_code.id;

  insert into public.events (event_type, entity_type, entity_id, actor_type, ip, details)
  values ('access_code_consumed', 'access_code', v_code.id, 'user', p_ip, jsonb_build_object('payment_id', v_code.payment_id));

  granted := true;
  reason := 'ok';
  used_at := v_now;
  return next;
end;
$$;

revoke all on function public.consume_code(text, inet) from public;
grant execute on function public.consume_code(text, inet) to service_role;

-- Align admin view to explicit state.
create or replace view public.admin_codes as
select
  c.id as code_id,
  c.payment_id as purchase_id,
  p.product_code,
  p.status as purchase_status,
  c.code_last2,
  c.issued_at,
  c.valid_until,
  c.used_at,
  c.revoked_at,
  c.revoke_reason,
  case
    when c.revoked_at is not null then 'revoked'
    when c.used_at is not null then 'used'
    when now() > c.valid_until then 'expired'
    else 'issued'
  end as code_status
from public.access_codes c
join public.payments p on p.id = c.payment_id;

grant select on table public.admin_codes to service_role;

