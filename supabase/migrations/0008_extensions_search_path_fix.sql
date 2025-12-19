-- Fix: Supabase hosted installs `pgcrypto` into `extensions` schema.
-- Ensure helper functions can resolve `digest()` and `gen_random_bytes()` even when callers set `search_path = public`.

create schema if not exists extensions;
create extension if not exists pgcrypto;

create or replace function public.sha256_text(p_value text)
returns bytea
language sql
immutable
set search_path = public, extensions, pg_catalog
as $$
  select digest(convert_to(p_value, 'utf8'), 'sha256');
$$;

create or replace function public.gen_token()
returns text
language sql
volatile
set search_path = public, extensions, pg_catalog
as $$
  select replace(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=', '');
$$;

create or replace function public.gen_six_digit_code()
returns text
language plpgsql
volatile
set search_path = public, extensions, pg_catalog
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

