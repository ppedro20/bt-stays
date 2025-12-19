-- Remove unused index flagged by performance advisor.
drop index if exists public.access_codes_valid_until_idx;
