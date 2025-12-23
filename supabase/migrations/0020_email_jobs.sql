-- MODULE 20 - EMAIL JOB QUEUE (POSTGRES)
-- Minimal queue table for Stripe email jobs.

create table if not exists public.email_jobs (
  job_id text primary key,
  event_type text not null,
  status text not null default 'pending',
  attempts int not null default 0,
  max_attempts int not null default 5,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_jobs_status_check check (status in ('pending', 'processing', 'failed', 'completed'))
);

create index if not exists email_jobs_ready_idx
on public.email_jobs (status, next_attempt_at);

alter table public.email_jobs enable row level security;
create policy email_jobs_all_service_role
on public.email_jobs
for all
to service_role
using (true)
with check (true);
