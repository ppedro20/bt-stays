-- Supabase Security Advisor (lint 0011): enforce immutable search_path at the catalog level.
-- (Some linters only check `pg_proc.proconfig`, which is what ALTER FUNCTION updates.)

alter function public.is_admin(uuid) set search_path = public, extensions, pg_catalog;
alter function public.is_superadmin(uuid) set search_path = public, extensions, pg_catalog;

alter function public.events_append_only() set search_path = public, extensions, pg_catalog;
alter function public.assert_service_role_write() set search_path = public, extensions, pg_catalog;
alter function public.enforce_access_code_lifecycle() set search_path = public, extensions, pg_catalog;
alter function public.prevent_access_code_delete() set search_path = public, extensions, pg_catalog;
alter function public.access_codes_require_paid_payment() set search_path = public, extensions, pg_catalog;
