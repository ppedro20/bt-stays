-- Ensure provider_checkout_session_id exists even if earlier migration was applied without it.

alter table public.payments
  add column if not exists provider_checkout_session_id text null;

create unique index if not exists payments_provider_checkout_session_uidx
on public.payments (provider, provider_checkout_session_id)
where provider is not null and provider_checkout_session_id is not null;
