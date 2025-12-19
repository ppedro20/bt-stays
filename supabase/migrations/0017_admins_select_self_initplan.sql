-- Fix RLS initplan for admins_select_self (avoid per-row auth.uid() eval).
drop policy if exists admins_select_self on public.admins;

create policy admins_select_self
on public.admins
for select
to authenticated
using ((select auth.uid()) = user_id);
