-- Supabase Security Advisor (lint 0010): avoid SECURITY DEFINER views.
-- Postgres 15+ supports `security_invoker` to ensure the querying user's privileges + RLS apply.

alter view if exists public.admin_audit_recent set (security_invoker = true);
alter view if exists public.admin_codes set (security_invoker = true);
alter view if exists public.admin_payments set (security_invoker = true);
alter view if exists public.access_codes_with_state set (security_invoker = true);
alter view if exists public.events_timeline set (security_invoker = true);

