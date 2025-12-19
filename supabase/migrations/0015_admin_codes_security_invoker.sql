-- Ensure admin_codes view uses invoker privileges (Supabase lint 0010).
-- admin_codes was recreated after 0009_views_security_invoker.sql.

alter view if exists public.admin_codes set (security_invoker = true);
