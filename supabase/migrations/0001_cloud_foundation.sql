-- MODULE 1 – CLOUD FOUNDATION
-- Goal: immutable + secure backend foundation (RLS everywhere, no public writes).

create schema if not exists extensions;
create extension if not exists pgcrypto;
set search_path = public, extensions, pg_catalog;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type public.payment_status as enum ('created', 'paid', 'canceled');
  end if;
end $$;

-- Core entities
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'superadmin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  status public.payment_status not null default 'created',
  created_at timestamptz not null default now(),
  paid_at timestamptz null,
  canceled_at timestamptz null,
  product_code text not null default 'day_pass',
  validity_hours int not null default 24 check (validity_hours > 0),
  amount_cents int not null default 0 check (amount_cents >= 0),
  currency text not null default 'EUR',
  payment_token_hash bytea not null unique,
  payment_token_last4 text not null,
  access_code_id uuid null unique
);

create index if not exists payments_created_at_idx on public.payments (created_at desc);

create table if not exists public.access_codes (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  code_hash bytea not null unique,
  code_last2 text not null,
  issued_at timestamptz not null default now(),
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  used_at timestamptz null,
  revoked_at timestamptz null,
  revoke_reason text null,
  constraint access_codes_one_per_payment unique (payment_id)
);

create index if not exists access_codes_valid_until_idx on public.access_codes (valid_until desc);
create index if not exists access_codes_used_at_idx on public.access_codes (used_at desc);

create table if not exists public.events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event_type text not null,
  entity_type text not null,
  entity_id uuid null,
  actor_type text not null,
  actor_id uuid null,
  ip inet null,
  details jsonb not null default '{}'::jsonb
);

create index if not exists events_created_at_idx on public.events (created_at desc);
create index if not exists events_entity_idx on public.events (entity_type, entity_id);

-- RLS everywhere
alter table public.admins enable row level security;
alter table public.payments enable row level security;
alter table public.access_codes enable row level security;
alter table public.events enable row level security;

-- Helpers
create or replace function public.sha256_text(p_value text)
returns bytea
language sql
immutable
as $$
  select digest(convert_to(p_value, 'utf8'), 'sha256');
$$;

revoke all on function public.sha256_text(text) from public;
grant execute on function public.sha256_text(text) to service_role;

create or replace function public.gen_token()
returns text
language sql
volatile
as $$
  select replace(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=', '');
$$;

revoke all on function public.gen_token() from public;
grant execute on function public.gen_token() to service_role;

create or replace function public.gen_six_digit_code()
returns text
language plpgsql
volatile
as $$
declare
  v_n int;
begin
  v_n :=
    100000
    + (
      (
        (get_byte(gen_random_bytes(2), 0)::int << 8)
        + get_byte(gen_random_bytes(2), 1)::int
      ) % 900000
    );
  return lpad(v_n::text, 6, '0');
end;
$$;

revoke all on function public.gen_six_digit_code() from public;
grant execute on function public.gen_six_digit_code() to service_role;

create or replace function public.is_admin(p_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.admins a
    where a.user_id = p_user_id and a.active = true
  );
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_admin(uuid) to service_role;

create or replace function public.is_superadmin(p_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.admins a
    where a.user_id = p_user_id and a.active = true and a.role = 'superadmin'
  );
$$;

revoke all on function public.is_superadmin(uuid) from public;
grant execute on function public.is_superadmin(uuid) to authenticated;
grant execute on function public.is_superadmin(uuid) to service_role;

-- Security policies: no public writes anywhere.
create policy admins_select_self
on public.admins
for select
to authenticated
using (auth.uid() = user_id);

create policy admins_all_service_role
on public.admins
for all
to service_role
using (true)
with check (true);

create policy payments_all_service_role
on public.payments
for all
to service_role
using (true)
with check (true);

create policy access_codes_all_service_role
on public.access_codes
for all
to service_role
using (true)
with check (true);

create policy events_all_service_role
on public.events
for all
to service_role
using (true)
with check (true);

-- Enforce: events is append-only (even for service_role).
create or replace function public.events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'events_is_append_only';
end;
$$;

drop trigger if exists trg_events_no_update on public.events;
drop trigger if exists trg_events_no_delete on public.events;

create trigger trg_events_no_update
before update on public.events
for each row execute function public.events_append_only();

create trigger trg_events_no_delete
before delete on public.events
for each row execute function public.events_append_only();

-- Enforce: access_codes writable only via server logic (service_role).
create or replace function public.assert_service_role_write()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), 'anon') <> 'service_role' then
    raise exception 'access_codes_writable_only_via_server_logic';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_access_codes_write_guard on public.access_codes;
create trigger trg_access_codes_write_guard
before insert or update or delete on public.access_codes
for each row execute function public.assert_service_role_write();

-- Server logic (RPCs) — the only way the system mutates state.
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
  -- MVP: single product, deterministic defaults.
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

  insert into public.events (event_type, entity_type, entity_id, actor_type, details)
  values ('payment_created', 'payment', payment_id, 'user', jsonb_build_object('product_code', p_product_code));

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
      paid_at = now()
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
  values ('payment_paid_demo', 'payment', v_payment.id, 'system', jsonb_build_object('method', 'demo'));

  insert into public.events (event_type, entity_type, entity_id, actor_type, details)
  values ('access_code_issued', 'access_code', v_code_id, 'system', jsonb_build_object('payment_id', v_payment.id, 'valid_until', valid_until));

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
  if p_code is null or length(trim(p_code)) <> 6 then
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

create or replace function public.revoke_access_code(p_access_code_id uuid, p_reason text)
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

  insert into public.events (event_type, entity_type, entity_id, actor_type, details)
  values ('access_code_revoked', 'access_code', p_access_code_id, 'admin', jsonb_build_object('reason', nullif(trim(p_reason), '')));
end;
$$;

revoke all on function public.revoke_access_code(uuid, text) from public;
grant execute on function public.revoke_access_code(uuid, text) to service_role;

create or replace function public.admin_open_gate(p_ip inet default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.events (event_type, entity_type, entity_id, actor_type, ip, details)
  values ('gate_open_remote', 'gate', null, 'admin', p_ip, '{}'::jsonb);
end;
$$;

revoke all on function public.admin_open_gate(inet) from public;
grant execute on function public.admin_open_gate(inet) to service_role;

-- Admin-oriented views for audit/ops (readable by service_role; exposed via Edge Functions)
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
    else 'active'
  end as code_status
from public.access_codes c
join public.payments p on p.id = c.payment_id;

create or replace view public.admin_audit_recent as
select *
from public.events
order by created_at desc
limit 200;

grant usage on schema public to service_role;
grant select on table public.admin_codes to service_role;
grant select on table public.admin_audit_recent to service_role;
