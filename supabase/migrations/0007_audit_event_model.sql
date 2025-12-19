-- MODULE 8 — AUDIT & EVENT MODEL
-- Goal: full traceability, zero ambiguity.
-- - Events are immutable (already enforced via triggers on public.events).
-- - Every meaningful action emits a canonical event.
-- - Expiry is deterministic; we expose a synthetic code_expired event in a timeline view.

-- Canonical event names:
-- purchase_started
-- payment_confirmed
-- code_issued
-- code_used
-- code_revoked
-- code_expired (synthetic; timestamp = valid_until)

-- Timeline view: stored events + deterministic expiry events.
create or replace view public.events_timeline as
select
  e.id::text as event_id,
  e.created_at,
  e.event_type,
  e.entity_type,
  e.entity_id,
  e.actor_type,
  e.actor_id,
  e.ip,
  e.details,
  false as synthetic
from public.events e
union all
select
  'exp:' || c.id::text as event_id,
  c.valid_until as created_at,
  'code_expired' as event_type,
  'access_code' as entity_type,
  c.id as entity_id,
  'system' as actor_type,
  null::uuid as actor_id,
  null::inet as ip,
  jsonb_build_object('payment_id', c.payment_id, 'valid_until', c.valid_until) as details,
  true as synthetic
from public.access_codes c
where now() > c.valid_until
  and c.used_at is null
  and c.revoked_at is null
  and not exists (
    select 1
    from public.events e2
    where e2.entity_type = 'access_code'
      and e2.entity_id = c.id
      and e2.event_type = 'code_expired'
  );

grant select on table public.events_timeline to service_role;

-- Admin read model includes timeline (for "no logs outside DB").
drop view if exists public.admin_audit_recent;
create view public.admin_audit_recent as
select *
from public.events_timeline
order by created_at desc
limit 200;

grant select on table public.admin_audit_recent to service_role;

-- Update server logic to emit canonical event names.

create or replace function public.create_payment(p_product_code text default 'day_pass')
returns table (
  payment_id uuid,
  payment_token text,
  amount_cents int,
  currency text,
  validity_hours int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_hash bytea;
  v_last4 text;
  v_amount int := 0;
  v_currency text := 'EUR';
  v_validity int := 24;
begin
  if p_product_code is null or trim(p_product_code) <> 'day_pass' then
    raise exception 'product_not_found';
  end if;

  v_token := public.gen_token();
  v_hash := public.sha256_text(v_token);
  v_last4 := right(v_token, 4);

  insert into public.payments (
    status,
    product_code,
    validity_hours,
    amount_cents,
    currency,
    payment_token_hash,
    payment_token_last4
  )
  values ('created', p_product_code, v_validity, v_amount, v_currency, v_hash, v_last4)
  returning id into payment_id;

  insert into public.events (event_type, entity_type, entity_id, actor_type, actor_id, details)
  values (
    'purchase_started',
    'payment',
    payment_id,
    'public_user',
    null,
    jsonb_build_object(
      'product_code', p_product_code,
      'validity_hours', v_validity,
      'amount_cents', v_amount,
      'currency', v_currency
    )
  );

  payment_token := v_token;
  amount_cents := v_amount;
  currency := v_currency;
  validity_hours := v_validity;
  return next;
end;
$$;

revoke all on function public.create_payment(text) from public;
grant execute on function public.create_payment(text) to service_role;

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

  insert into public.events (event_type, entity_type, entity_id, actor_type, actor_id, details)
  values (
    'payment_confirmed',
    'payment',
    v_payment.id,
    'system',
    null,
    jsonb_build_object('method', 'mock')
  );

  valid_until := now() + make_interval(hours => v_payment.validity_hours);

  v_attempt := 0;
  while v_attempt < 10 loop
    v_attempt := v_attempt + 1;
    v_code := public.gen_six_digit_code();
    begin
      insert into public.access_codes (payment_id, code_hash, code_last2, valid_from, valid_until)
      values (v_payment.id, public.sha256_text(v_code), right(v_code, 2), now(), valid_until)
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

  insert into public.events (event_type, entity_type, entity_id, actor_type, actor_id, details)
  values (
    'code_issued',
    'access_code',
    v_code_id,
    'system',
    null,
    jsonb_build_object('payment_id', v_payment.id, 'valid_until', valid_until)
  );

  payment_id := v_payment.id;
  access_code := v_code;
  return next;
end;
$$;

revoke all on function public.demo_pay_and_issue_code(text) from public;
grant execute on function public.demo_pay_and_issue_code(text) to service_role;

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
    insert into public.events (event_type, entity_type, entity_id, actor_type, actor_id, ip, details)
    values ('access_denied', 'access_code', null, 'public_user', null, p_ip, jsonb_build_object('reason', 'not_found'));
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
    insert into public.events (event_type, entity_type, entity_id, actor_type, actor_id, ip, details)
    values ('access_denied', 'access_code', v_code.id, 'public_user', null, p_ip, jsonb_build_object('reason', 'revoked'));
    granted := false;
    reason := 'revoked';
    return next;
    return;
  end if;

  if v_code.used_at is not null then
    insert into public.events (event_type, entity_type, entity_id, actor_type, actor_id, ip, details)
    values ('access_denied', 'access_code', v_code.id, 'public_user', null, p_ip, jsonb_build_object('reason', 'already_used'));
    granted := false;
    reason := 'already_used';
    return next;
    return;
  end if;

  if v_now > v_code.valid_until then
    insert into public.events (event_type, entity_type, entity_id, actor_type, actor_id, ip, details)
    values ('access_denied', 'access_code', v_code.id, 'public_user', null, p_ip, jsonb_build_object('reason', 'expired'));
    granted := false;
    reason := 'expired';
    return next;
    return;
  end if;

  update public.access_codes
  set used_at = v_now
  where id = v_code.id;

  insert into public.events (event_type, entity_type, entity_id, actor_type, actor_id, ip, details)
  values (
    'code_used',
    'access_code',
    v_code.id,
    'public_user',
    null,
    p_ip,
    jsonb_build_object('payment_id', v_code.payment_id)
  );

  granted := true;
  reason := 'ok';
  used_at := v_now;
  return next;
end;
$$;

revoke all on function public.consume_code(text, inet) from public;
grant execute on function public.consume_code(text, inet) to service_role;

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
    'code_revoked',
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

create or replace function public.process_payment_webhook_event(
  p_provider text,
  p_event_id text,
  p_provider_payment_id text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_code text;
  v_code_id uuid;
  v_attempt int;
  v_valid_until timestamptz;
begin
  if p_provider is null or length(trim(p_provider)) = 0 then
    raise exception 'missing_provider';
  end if;
  if p_event_id is null or length(trim(p_event_id)) = 0 then
    raise exception 'missing_event_id';
  end if;

  insert into public.payment_provider_events (provider, event_id, provider_payment_id, payload)
  values (trim(p_provider), trim(p_event_id), nullif(trim(p_provider_payment_id), ''), coalesce(p_payload, '{}'::jsonb))
  on conflict (provider, event_id) do nothing;

  if not found then
    return;
  end if;

  if p_provider_payment_id is null or length(trim(p_provider_payment_id)) = 0 then
    insert into public.events (event_type, entity_type, entity_id, actor_type, details)
    values ('payment_webhook_unmatched', 'payment', null, 'system', jsonb_build_object('provider', p_provider, 'event_id', p_event_id));
    return;
  end if;

  select *
    into v_payment
  from public.payments
  where provider = trim(p_provider) and provider_payment_id = trim(p_provider_payment_id)
  for update;

  if not found then
    insert into public.events (event_type, entity_type, entity_id, actor_type, details)
    values (
      'payment_webhook_unmatched',
      'payment',
      null,
      'system',
      jsonb_build_object('provider', p_provider, 'event_id', p_event_id, 'provider_payment_id', p_provider_payment_id)
    );
    return;
  end if;

  if v_payment.status = 'paid' and v_payment.access_code_id is not null then
    insert into public.events (event_type, entity_type, entity_id, actor_type, details)
    values ('payment_webhook_duplicate', 'payment', v_payment.id, 'system', jsonb_build_object('provider', p_provider, 'event_id', p_event_id));
    return;
  end if;

  update public.payments
  set status = 'paid',
      paid_at = coalesce(paid_at, now()),
      provider_status = coalesce(provider_status, 'paid'),
      provider_payload = coalesce(p_payload, '{}'::jsonb),
      confirmed_via = 'webhook',
      confirmed_at = now()
  where id = v_payment.id;

  insert into public.events (event_type, entity_type, entity_id, actor_type, details)
  values (
    'payment_confirmed',
    'payment',
    v_payment.id,
    'system',
    jsonb_build_object('method', 'webhook', 'provider', p_provider, 'event_id', p_event_id)
  );

  v_valid_until := now() + make_interval(hours => v_payment.validity_hours);

  v_attempt := 0;
  while v_attempt < 10 loop
    v_attempt := v_attempt + 1;
    v_code := public.gen_six_digit_code();
    begin
      insert into public.access_codes (payment_id, code_hash, code_last2, valid_from, valid_until)
      values (v_payment.id, public.sha256_text(v_code), right(v_code, 2), now(), v_valid_until)
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
  values (
    'code_issued',
    'access_code',
    v_code_id,
    'system',
    jsonb_build_object('payment_id', v_payment.id, 'valid_until', v_valid_until, 'provider', p_provider)
  );
end;
$$;

revoke all on function public.process_payment_webhook_event(text, text, text, jsonb) from public;
grant execute on function public.process_payment_webhook_event(text, text, text, jsonb) to service_role;
