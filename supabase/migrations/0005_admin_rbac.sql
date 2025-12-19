-- MODULE 6 — ADMIN AUTH + RBAC
-- Goal: protect administrative power and prevent privilege escalation.

-- Expand confirmed_via to support manual issuance (superadmin only, via server logic).
alter table public.payments
  drop constraint if exists payments_confirmed_via_check;

alter table public.payments
  add constraint payments_confirmed_via_check
  check (confirmed_via in ('mock', 'webhook', 'manual'));

-- Improve audit: include actor_id (optional) for admin actions.
create or replace function public.revoke_access_code(
  p_access_code_id uuid,
  p_reason text,
  p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.access_codes
  set revoked_at = now(),
      revoke_reason = nullif(trim(p_reason), '')
  where id = p_access_code_id and revoked_at is null;

  insert into public.events (event_type, entity_type, entity_id, actor_type, actor_id, details)
  values (
    'access_code_revoked',
    'access_code',
    p_access_code_id,
    'admin',
    p_actor_id,
    jsonb_build_object('reason', nullif(trim(p_reason), ''))
  );
end;
$$;

revoke all on function public.revoke_access_code(uuid, text, uuid) from public;
grant execute on function public.revoke_access_code(uuid, text, uuid) to service_role;

create or replace function public.admin_open_gate(
  p_ip inet default null,
  p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.events (event_type, entity_type, entity_id, actor_type, actor_id, ip, details)
  values ('gate_open_remote', 'gate', null, 'admin', p_actor_id, p_ip, '{}'::jsonb);
end;
$$;

revoke all on function public.admin_open_gate(inet, uuid) from public;
grant execute on function public.admin_open_gate(inet, uuid) to service_role;

-- Superadmin-only operation (prepared for dashboard): manual code issuance.
-- Creates a paid payment (amount 0) and returns the code plaintext exactly once.
create or replace function public.issue_manual_code(
  p_validity_hours int default 24,
  p_note text default null,
  p_actor_id uuid default null
)
returns table (
  payment_id uuid,
  access_code_id uuid,
  access_code text,
  valid_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
  v_code text;
  v_code_id uuid;
  v_attempt int;
begin
  if p_validity_hours is null or p_validity_hours <= 0 or p_validity_hours > 24 then
    raise exception 'invalid_validity_hours';
  end if;

  insert into public.payments (
    status,
    paid_at,
    product_code,
    validity_hours,
    amount_cents,
    currency,
    payment_token_hash,
    payment_token_last4,
    confirmed_via,
    confirmed_at,
    provider_payload
  )
  values (
    'paid',
    now(),
    'day_pass',
    p_validity_hours,
    0,
    'EUR',
    public.sha256_text(public.gen_token()),
    'MANL',
    'manual',
    now(),
    jsonb_build_object('note', nullif(trim(p_note), ''))
  )
  returning id into v_payment_id;

  valid_until := now() + make_interval(hours => p_validity_hours);

  v_attempt := 0;
  while v_attempt < 10 loop
    v_attempt := v_attempt + 1;
    v_code := public.gen_six_digit_code();
    begin
      insert into public.access_codes (payment_id, code_hash, code_last2, valid_from, valid_until)
      values (v_payment_id, public.sha256_text(v_code), right(v_code, 2), now(), valid_until)
      returning id into v_code_id;
      exit;
    exception when unique_violation then
      -- retry
    end;
  end loop;

  if v_code_id is null then
    raise exception 'code_generation_failed';
  end if;

  update public.payments
  set access_code_id = v_code_id
  where id = v_payment_id;

  insert into public.events (event_type, entity_type, entity_id, actor_type, actor_id, details)
  values (
    'payment_paid_manual',
    'payment',
    v_payment_id,
    'admin',
    p_actor_id,
    jsonb_build_object('method', 'manual', 'note', nullif(trim(p_note), ''))
  );

  insert into public.events (event_type, entity_type, entity_id, actor_type, actor_id, details)
  values (
    'access_code_issued',
    'access_code',
    v_code_id,
    'admin',
    p_actor_id,
    jsonb_build_object('payment_id', v_payment_id, 'valid_until', valid_until, 'manual', true)
  );

  payment_id := v_payment_id;
  access_code_id := v_code_id;
  access_code := v_code;
  return next;
end;
$$;

revoke all on function public.issue_manual_code(int, text, uuid) from public;
grant execute on function public.issue_manual_code(int, text, uuid) to service_role;

