# Runbook (dev + deploy)

This is the step-by-step guide to run the project locally and deploy.

## Prereqs

- Node.js 20+
- Supabase CLI
- Stripe account (test mode) if using Stripe

## 1) Clone and install dependencies

From repo root:

```bash
npm install
```

## 2) Start Supabase locally

```bash
npx supabase start
```

## 3) Apply database migrations

Local reset (fresh DB):

```bash
npx supabase db reset
```

Remote project (after linking):

```bash
npx supabase db push
```

## 4) Link a remote Supabase project (once)

```bash
npx supabase login
npx supabase link --project-ref <project_ref>
```

Enable in Supabase:

- Postgres
- Auth (Email/Password)
- Edge Functions

## 5) Supabase Edge Functions env

Create `supabase/.env` from `supabase/.env.example`.

Required:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Payments:

- `PAYMENTS_PROVIDER=mock` (default) or `stripe`
- `PAYMENTS_DAY_PASS_AMOUNT_CENTS`
- `PAYMENTS_CURRENCY` (default `EUR`)

Stripe (if real):

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_SUCCESS_URL` (example: `https://<user-web>/#/b3/stripe?session_id={CHECKOUT_SESSION_ID}`)
- `STRIPE_CANCEL_URL` (example: `https://<user-web>/#/b1`)

PWA advanced:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `PUSH_ADMIN_SECRET`

## 6) Deploy Supabase Edge Functions

```bash
npx supabase functions deploy
```

## 7) Seed superadmin (manual)

1. Create a user in Supabase Auth (email/password).
2. Copy the Auth user UUID.
3. Run:

```sql
insert into public.admins (user_id, role, active)
values ('<AUTH_USER_UUID>', 'superadmin', true)
on conflict (user_id) do update set role = excluded.role, active = excluded.active;
```

## 8) App envs

Create env files from examples:

- `apps/user-web/.env` from `apps/user-web/.env.example`
- `apps/admin-web/.env` from `apps/admin-web/.env.example`

Vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_VAPID_PUBLIC_KEY` (optional, for push)

## 9) Run apps locally

From repo root:

```bash
npm run dev:user
```

In another terminal:

```bash
npm run dev:admin
```

## 10) Build + preview locally

```bash
npx tsc -b
npm run build
npm run preview:user
```

## 11) Deploy user-web (Vercel)

- Set project root to `apps/user-web`.
- `vercel.json` provides SPA rewrite and cache headers.
- Ensure HTTPS is enabled.

## 12) Deploy admin-web (Vercel)

- Set project root to `apps/admin-web`.
- Use `vercel.json` for SPA rewrite and cache headers.
- Ensure HTTPS is enabled.

## 13) Native wrappers (Capacitor)

From `apps/user-web`:

```bash
npm run build
npx cap add android
npx cap add ios
npx cap sync
```

Open native projects:

```bash
npx cap open android
npx cap open ios
```

Notes:
- Update `apps/user-web/capacitor.config.ts` with your final `appId`.
- Android requires Android Studio; iOS requires Xcode on macOS.
