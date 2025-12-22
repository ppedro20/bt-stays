-- MODULE 19 - PWA ADVANCED FEATURES
-- Adds push subscriptions, PWA analytics, and optional client-supplied payment token.

-- 1) PWA analytics events (service role only)
create table if not exists public.pwa_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event_type text not null,
  device_id text null,
  user_agent text null,
  url text null,
  referrer text null,
  payload jsonb not null default '{}'::jsonb
);

alter table public.pwa_events enable row level security;
create policy pwa_events_all_service_role
on public.pwa_events
for all
to service_role
using (true)
with check (true);

-- 2) Push subscriptions (service role only)
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  device_id text null,
  user_agent text null,
  active boolean not null default true
);

create unique index if not exists push_subscriptions_endpoint_uidx
on public.push_subscriptions (endpoint);

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_all_service_role
on public.push_subscriptions
for all
to service_role
using (true)
with check (true);

-- 3) Allow client-supplied payment token for idempotent retries.
create or replace function public.create_payment(
  p_product_code text default 'day_pass',
  p_payment_token text default null
)
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
  v_inserted boolean := false;
begin
  if p_product_code is null or trim(p_product_code) <> 'day_pass' then
    raise exception 'product_not_found';
  end if;

  if p_payment_token is not null and length(trim(p_payment_token)) > 0 then
    v_token := trim(p_payment_token);
  else
    v_token := public.gen_token();
  end if;

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
  on conflict (payment_token_hash) do nothing
  returning id into payment_id;

  if payment_id is null then
    select id into payment_id
    from public.payments
    where payment_token_hash = v_hash;
  else
    v_inserted := true;
  end if;

  if v_inserted then
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
  end if;

  payment_token := v_token;
  amount_cents := v_amount;
  currency := v_currency;
  validity_hours := v_validity;
  return next;
end;
$$;

revoke all on function public.create_payment(text, text) from public;
grant execute on function public.create_payment(text, text) to service_role;
