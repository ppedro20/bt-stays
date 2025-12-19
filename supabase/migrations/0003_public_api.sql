-- MODULE 3 — PUBLIC API (USER-FACING)
-- Exactly three public operations are exposed via Edge Functions:
-- 1) start_purchase -> create_payment()
-- 2) confirm_purchase -> demo_pay_and_issue_code()
-- 3) check_access_status -> check_access_status()

create or replace function public.check_access_status(p_code text)
returns table (
  state text,
  can_access boolean,
  valid_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_row public.access_codes%rowtype;
begin
  if p_code is null or trim(p_code) !~ '^[0-9]{6}$' then
    state := 'invalid_format';
    can_access := false;
    valid_until := null;
    return next;
    return;
  end if;

  select *
    into v_row
  from public.access_codes
  where code_hash = public.sha256_text(trim(p_code));

  if not found then
    state := 'not_found';
    can_access := false;
    valid_until := null;
    return next;
    return;
  end if;

  valid_until := v_row.valid_until;

  if v_row.revoked_at is not null then
    state := 'revoked';
    can_access := false;
    return next;
    return;
  end if;

  if v_row.used_at is not null then
    state := 'used';
    can_access := false;
    return next;
    return;
  end if;

  if v_now > v_row.valid_until then
    state := 'expired';
    can_access := false;
    return next;
    return;
  end if;

  state := 'issued';
  can_access := true;
  return next;
end;
$$;

revoke all on function public.check_access_status(text) from public;
grant execute on function public.check_access_status(text) to service_role;

