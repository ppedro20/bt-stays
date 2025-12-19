-- Supabase Security Advisor (lint 0011): make function `search_path` immutable.
-- This prevents malicious objects from being resolved via a caller-controlled `search_path`.

create or replace function public.is_admin(p_user_id uuid)
returns boolean
language sql
stable
set search_path = public, extensions, pg_catalog
as $$
  select exists (
    select 1
    from public.admins a
    where a.user_id = p_user_id and a.active = true
  );
$$;

create or replace function public.is_superadmin(p_user_id uuid)
returns boolean
language sql
stable
set search_path = public, extensions, pg_catalog
as $$
  select exists (
    select 1
    from public.admins a
    where a.user_id = p_user_id and a.active = true and a.role = 'superadmin'
  );
$$;

create or replace function public.events_append_only()
returns trigger
language plpgsql
set search_path = public, extensions, pg_catalog
as $$
begin
  raise exception 'events_is_append_only';
end;
$$;

create or replace function public.assert_service_role_write()
returns trigger
language plpgsql
set search_path = public, extensions, pg_catalog
as $$
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' then
    raise exception 'access_codes_writable_only_via_server_logic';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_access_code_lifecycle()
returns trigger
language plpgsql
set search_path = public, extensions, pg_catalog
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

create or replace function public.prevent_access_code_delete()
returns trigger
language plpgsql
set search_path = public, extensions, pg_catalog
as $$
begin
  raise exception 'access_codes_delete_forbidden';
end;
$$;

create or replace function public.access_codes_require_paid_payment()
returns trigger
language plpgsql
set search_path = public, extensions, pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.payments p
    where p.id = new.payment_id and p.status = 'paid' and p.paid_at is not null
  ) then
    raise exception 'access_code_requires_paid_payment';
  end if;
  return new;
end;
$$;

