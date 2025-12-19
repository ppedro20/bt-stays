# Runbook (dev + deploy)

## Monorepo structure (non-optional)

- `apps/user-web` — user browser app (no login)
- `apps/admin-web` — admin browser app (Supabase Auth + RBAC)
- `supabase` — migrations + Edge Functions
- `packages/shared` — shared helpers/types (no business logic)

Conventions:

- UUID everywhere
- UTC timestamps in DB (`timestamptz`)
- ISO 8601 dates over the wire
- JSON structured logs (Edge Functions)

## 1) Create Supabase project
npx supabase init
npx supabase login
npx supabase start
npx supabase functions new <hello>
npx supabase functions serve
npx supabase functions deploy <hello>

Enable:
- Postgres
- Auth (Email / Password)
- Edge Functions

## 2) Apply DB migrations

Apply all files in `supabase/migrations/` (in name order).

## 3) Seed superadmin (manual)

1. Create a user in Supabase Auth (email/password).
2. Copy the Auth user UUID.
3. Run:

```sql
insert into public.admins (user_id, role, active)
values ('<AUTH_USER_UUID>', 'superadmin', true)
on conflict (user_id) do update set role = excluded.role, active = excluded.active;
```

## 4) Deploy Edge Functions

Deploy all folders under `supabase/functions/`.

Prepared (not live by default):

- `payment_webhook` requires `PAYMENT_WEBHOOK_SECRET` and header `x-webhook-secret`.

## 5) Configure apps

Create env files from examples:

- `apps/user-web/.env` from `apps/user-web/.env.example`
- `apps/admin-web/.env` from `apps/admin-web/.env.example`

Vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 6) Run locally

At repo root:

```bash
npm install
npm run dev:user
```

In another terminal:

```bash
npm run dev:admin
```

## 7) Admin exports / observability

Dashboard exports CSV via Edge Functions:

- `admin_export_codes`
- `admin_export_payments`
- `admin_export_events`

Edge Functions emit JSON structured logs and include `x-request-id` on export responses for correlation.

