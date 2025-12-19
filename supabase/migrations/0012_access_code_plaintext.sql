-- MODULE C3 support: store access code plaintext (admin-only).
-- This enables the Admin Code Detail screen to display the full 6-digit code as the single human source of truth.
-- RLS remains enabled; only service_role reads via Edge Functions.

alter table public.access_codes
  add column if not exists code_plaintext text null;

-- Update admin read model to include plaintext.
drop view if exists public.admin_codes;
create or replace view public.admin_codes as
select
  c.id as code_id,
  c.payment_id as purchase_id,
  p.product_code,
  p.status as purchase_status,
  c.code_last2,
  c.code_plaintext,
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

-- Ensure issuance paths persist plaintext for admins (does not change public responses).

create or replace function public.demo_pay_and_issue_code(p_payment_token text)
returns table (
  payment_id uuid,
  access_code text,
  valid_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_code text;
  v_code_id uuid;
  v_attempt int;
begin
  select *
    into v_payment
  from public.payments
  where payment_token_hash = public.sha256_text(p_payment_token)
  for update;

  if not found then
    raise exception 'payment_not_found';
  end if;

  if v_payment.status <> 'created' then
    raise exception 'payment_invalid_status';
  end if;

  update public.payments
  set status = 'paid',
      paid_at = now(),
      confirmed_via = 'mock',
      confirmed_at = now(),
      provider_payload = jsonb_build_object('method', 'mock')
  where id = v_payment.id;

  valid_until := now() + make_interval(hours => v_payment.validity_hours);

  v_attempt := 0;
  while v_attempt < 10 loop
    v_attempt := v_attempt + 1;
    v_code := public.gen_six_digit_code();
    begin
      insert into public.access_codes (payment_id, code_hash, code_last2, code_plaintext, valid_from, valid_until)
      values (v_payment.id, public.sha256_text(v_code), right(v_code, 2), v_code, now(), valid_until)
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
  where id = v_payment.id;

  insert into public.events (event_type, entity_type, entity_id, actor_type, details)
  values ('payment_paid_mock', 'payment', v_payment.id, 'system', jsonb_build_object('method', 'mock'));

  insert into public.events (event_type, entity_type, entity_id, actor_type, details)
  values ('code_issued', 'access_code', v_code_id, 'system', jsonb_build_object('payment_id', v_payment.id, 'valid_until', valid_until));

  payment_id := v_payment.id;
  access_code := v_code;
  return next;
end;
$$;

revoke all on function public.demo_pay_and_issue_code(text) from public;
grant execute on function public.demo_pay_and_issue_code(text) to service_role;

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

  insert into public.events (event_type, entity_type, entity_id, actor_type, actor_id, details)
  values (
    'payment_confirmed',
    'payment',
    v_payment_id,
    'admin',
    p_actor_id,
    jsonb_build_object('method', 'manual', 'note', nullif(trim(p_note), ''))
  );

  valid_until := now() + make_interval(hours => p_validity_hours);

  v_attempt := 0;
  while v_attempt < 10 loop
    v_attempt := v_attempt + 1;
    v_code := public.gen_six_digit_code();
    begin
      insert into public.access_codes (payment_id, code_hash, code_last2, code_plaintext, valid_from, valid_until)
      values (v_payment_id, public.sha256_text(v_code), right(v_code, 2), v_code, now(), valid_until)
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
    'code_issued',
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
