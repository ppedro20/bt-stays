-- MODULE 7 — ADMIN DASHBOARD (CORE OPS)
-- Admin-focused read models (views). Dashboard reads via Edge Functions only.

create or replace view public.admin_payments as
select
  p.id as payment_id,
  p.status,
  p.created_at,
  p.paid_at,
  p.canceled_at,
  p.product_code,
  p.validity_hours,
  p.amount_cents,
  p.currency,
  p.access_code_id,
  p.confirmed_via,
  p.confirmed_at,
  p.provider,
  p.provider_payment_id,
  p.provider_status
from public.payments p;

grant select on table public.admin_payments to service_role;

