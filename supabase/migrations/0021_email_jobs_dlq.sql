-- MODULE 21 - EMAIL JOBS DLQ
-- Dead-letter queue for permanently failed email jobs.

create table if not exists public.email_jobs_dlq (
  job_id text primary key,
  event_type text not null,
  attempts int not null,
  max_attempts int not null,
  last_error text not null,
  failed_at timestamptz not null default now()
);

alter table public.email_jobs_dlq enable row level security;
create policy email_jobs_dlq_all_service_role
on public.email_jobs_dlq
for all
to service_role
using (true)
with check (true);
