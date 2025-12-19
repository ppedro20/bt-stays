-- MODULE 4B - STRIPE PAYMENTS (WEBHOOK-DRIVEN)
-- Extend payment states and upgrade webhook processing for Stripe.

alter type public.payment_status add value if not exists 'pending';
alter type public.payment_status add value if not exists 'failed';
alter type public.payment_status add value if not exists 'expired';
alter type public.payment_status add value if not exists 'refunded';

alter table public.payments
  add column if not exists provider_checkout_session_id text null;

create unique index if not exists payments_provider_checkout_session_uidx
on public.payments (provider, provider_checkout_session_id)
where provider is not null and provider_checkout_session_id is not null;

drop function if exists public.process_payment_webhook_event(text, text, text, jsonb);
drop function if exists public.process_payment_webhook_event(text, text, text, text, text, jsonb);

create or replace function public.process_payment_webhook_event(
  p_provider text,
  p_event_id text,
  p_provider_payment_id text,
  p_event_type text,
  p_payment_status text,
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
  v_event_type text;
begin
  if p_provider is null or length(trim(p_provider)) = 0 then
    raise exception 'missing_provider';
  end if;
  if p_event_id is null or length(trim(p_event_id)) = 0 then
    raise exception 'missing_event_id';
  end if;
  if p_payment_status is null or length(trim(p_payment_status)) = 0 then
    raise exception 'missing_payment_status';
  end if;

  insert into public.payment_provider_events (provider, event_id, provider_payment_id, payload)
  values (trim(p_provider), trim(p_event_id), nullif(trim(p_provider_payment_id), ''), coalesce(p_payload, '{}'::jsonb))
  on conflict (provider, event_id) do nothing;

  if not found then
    return;
  end if;

  if p_provider_payment_id is null or length(trim(p_provider_payment_id)) = 0 then
    insert into public.events (event_type, entity_type, entity_id, actor_type, details)
    values (
      'payment_webhook_unmatched',
      'payment',
      null,
      'system',
      jsonb_build_object('provider', p_provider, 'event_id', p_event_id, 'event_type', p_event_type)
    );
    return;
  end if;

  select *
    into v_payment
  from public.payments
  where provider = trim(p_provider)
    and (
      provider_payment_id = trim(p_provider_payment_id)
      or provider_checkout_session_id = trim(p_provider_payment_id)
    )
  for update;

  if not found then
    insert into public.events (event_type, entity_type, entity_id, actor_type, details)
    values (
      'payment_webhook_unmatched',
      'payment',
      null,
      'system',
      jsonb_build_object(
        'provider', p_provider,
        'event_id', p_event_id,
        'event_type', p_event_type,
        'provider_payment_id', p_provider_payment_id
      )
    );
    return;
  end if;

  if trim(p_payment_status) = 'paid' then
    if v_payment.status = 'paid' and v_payment.access_code_id is not null then
      insert into public.events (event_type, entity_type, entity_id, actor_type, details)
      values (
        'payment_webhook_duplicate',
        'payment',
        v_payment.id,
        'system',
        jsonb_build_object('provider', p_provider, 'event_id', p_event_id, 'event_type', p_event_type)
      );
      return;
    end if;
  end if;

  update public.payments
  set status = trim(p_payment_status)::public.payment_status,
      paid_at = case when trim(p_payment_status) = 'paid' then coalesce(paid_at, now()) else paid_at end,
      canceled_at = case
        when trim(p_payment_status) in ('failed', 'expired', 'refunded') then coalesce(canceled_at, now())
        else canceled_at
      end,
      provider_status = coalesce(nullif(trim(p_payment_status), ''), provider_status),
      provider_payload = coalesce(p_payload, '{}'::jsonb),
      confirmed_via = case when trim(p_payment_status) = 'paid' then 'webhook' else confirmed_via end,
      confirmed_at = case when trim(p_payment_status) = 'paid' then now() else confirmed_at end
  where id = v_payment.id;

  if trim(p_payment_status) = 'paid' then
    v_event_type := 'payment_confirmed';
  elsif trim(p_payment_status) = 'failed' then
    v_event_type := 'payment_failed';
  elsif trim(p_payment_status) = 'expired' then
    v_event_type := 'payment_expired';
  elsif trim(p_payment_status) = 'refunded' then
    v_event_type := 'payment_refunded';
  else
    v_event_type := 'payment_status_updated';
  end if;

  insert into public.events (event_type, entity_type, entity_id, actor_type, details)
  values (
    v_event_type,
    'payment',
    v_payment.id,
    'system',
    jsonb_build_object(
      'method', 'webhook',
      'provider', p_provider,
      'event_id', p_event_id,
      'event_type', p_event_type,
      'status', trim(p_payment_status)
    )
  );

  if trim(p_payment_status) <> 'paid' then
    return;
  end if;

  v_valid_until := now() + make_interval(hours => v_payment.validity_hours);

  v_attempt := 0;
  while v_attempt < 10 loop
    v_attempt := v_attempt + 1;
    v_code := public.gen_six_digit_code();
    begin
      insert into public.access_codes (payment_id, code_hash, code_last2, code_plaintext, valid_from, valid_until)
      values (v_payment.id, public.sha256_text(v_code), right(v_code, 2), v_code, now(), v_valid_until)
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

revoke all on function public.process_payment_webhook_event(text, text, text, text, text, jsonb) from public;
grant execute on function public.process_payment_webhook_event(text, text, text, text, text, jsonb) to service_role;
