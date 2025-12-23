-- MODULE 22 - EMAIL EVENTS (AUDIT)
-- Optional audit table for email delivery attempts.

create table if not exists public.email_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event_id text not null,
  payment_id uuid null,
  email text null,
  status text not null,
  error text null
);

create index if not exists email_events_event_id_idx
on public.email_events (event_id);

alter table public.email_events enable row level security;
create policy email_events_all_service_role
on public.email_events
for all
to service_role
using (true)
with check (true);
