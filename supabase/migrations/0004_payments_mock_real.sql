-- MODULE 4 — PAYMENTS (MOCK → REAL)
-- Phase 1 (MVP): mock confirmation is the gatekeeper for code issuance.
-- Phase 2 (prepared): generic provider fields + webhook endpoint + idempotency (no Stripe lock-in).

-- Generic provider fields (prepared; not required for MVP mock).
alter table public.payments
  add column if not exists provider text null,
  add column if not exists provider_payment_id text null,
  add column if not exists provider_status text null,
  add column if not exists provider_payload jsonb not null default '{}'::jsonb,
  add column if not exists confirmed_via text null check (confirmed_via in ('mock', 'webhook')),
  add column if not exists confirmed_at timestamptz null;

create unique index if not exists payments_provider_payment_uidx
on public.payments (provider, provider_payment_id)
where provider is not null and provider_payment_id is not null;

-- Idempotency store for provider webhooks (prepared).
create table if not exists public.payment_provider_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  provider text not null,
  event_id text not null,
  provider_payment_id text null,
  payload jsonb not null default '{}'::jsonb,
  constraint payment_provider_events_provider_event_uidx unique (provider, event_id)
);

alter table public.payment_provider_events enable row level security;
create policy payment_provider_events_all_service_role
on public.payment_provider_events
for all
to service_role
using (true)
with check (true);

-- Enforce: payment must be paid before an access_code can exist (even for service_role).
create or replace function public.access_codes_require_paid_payment()
returns trigger
language plpgsql
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

drop trigger if exists trg_access_codes_require_paid_payment on public.access_codes;
create trigger trg_access_codes_require_paid_payment
before insert on public.access_codes
for each row execute function public.access_codes_require_paid_payment();

-- Prepared: webhook processing (idempotent). Does not return access code plaintext.
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

  -- Idempotency: if we've already seen this event, exit silently.
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
  values ('payment_paid_webhook', 'payment', v_payment.id, 'system', jsonb_build_object('provider', p_provider, 'event_id', p_event_id));

  insert into public.events (event_type, entity_type, entity_id, actor_type, details)
  values ('access_code_issued', 'access_code', v_code_id, 'system', jsonb_build_object('payment_id', v_payment.id, 'valid_until', v_valid_until));
end;
$$;

revoke all on function public.process_payment_webhook_event(text, text, text, jsonb) from public;
grant execute on function public.process_payment_webhook_event(text, text, text, jsonb) to service_role;

-- Phase 1: keep mock confirmation as the only way to issue codes for the public flow.
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

  insert into public.events (event_type, entity_type, entity_id, actor_type, details)
  values ('payment_paid_mock', 'payment', v_payment.id, 'system', jsonb_build_object('method', 'mock'));

  insert into public.events (event_type, entity_type, entity_id, actor_type, details)
  values ('access_code_issued', 'access_code', v_code_id, 'system', jsonb_build_object('payment_id', v_payment.id, 'valid_until', valid_until));

  payment_id := v_payment.id;
  access_code := v_code;
  return next;
end;
$$;

revoke all on function public.demo_pay_and_issue_code(text) from public;
grant execute on function public.demo_pay_and_issue_code(text) to service_role;

