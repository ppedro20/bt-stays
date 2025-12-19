# Runbook (dev + deploy)

## Monorepo structure (non-optional)

- `apps/user-web` - public user app (no login)
- `apps/admin-web` - admin app (Supabase Auth + RBAC)
- `supabase` - migrations + Edge Functions
- `packages/shared` - shared helpers/types (no business logic)

Conventions:

- UUID everywhere
- UTC timestamps in DB (`timestamptz`)
- ISO 8601 dates over the wire
- JSON structured logs (Edge Functions)

## Prereqs

- Node.js 20+
- Supabase CLI
- Stripe account (test mode)

## 1) Supabase project (local + remote)

Local dev:

```bash
npx supabase start
```

Remote project (once):

```bash
npx supabase login
npx supabase link --project-ref <project_ref>
```

Enable in Supabase:

- Postgres
- Auth (Email/Password)
- Edge Functions

## 2) Database migrations

Apply all files in `supabase/migrations/` in order.

Local:

```bash
npx supabase db reset
```

Remote:

```bash
npx supabase db push
```

## 3) Seed superadmin (manual)

1. Create a user in Supabase Auth (email/password).
2. Copy the Auth user UUID.
3. Run:

```sql
insert into public.admins (user_id, role, active)
values ('<AUTH_USER_UUID>', 'superadmin', true)
on conflict (user_id) do update set role = excluded.role, active = excluded.active;
```

## 4) Edge Functions env (required)

Create `supabase/.env` from `supabase/.env.example`.

Required:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Mock vs Stripe:

- `PAYMENTS_PROVIDER=mock` (default)
- `PAYMENTS_PROVIDER=stripe` (real)

Stripe (if real):

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_SUCCESS_URL` (example: `https://<user-web>/#/b3/stripe?session_id={CHECKOUT_SESSION_ID}`)
- `STRIPE_CANCEL_URL` (example: `https://<user-web>/#/b1`)
- `PAYMENTS_DAY_PASS_AMOUNT_CENTS`
- `PAYMENTS_CURRENCY` (default `EUR`)

## 5) Deploy Edge Functions

Deploy all folders under `supabase/functions/`:

```bash
npx supabase functions deploy
```

Key functions:

- `start_purchase` - creates payment + Stripe Checkout session (or mock)
- `payment_webhook` - Stripe signature validation + payment confirmation
- `payment_status` - user polling
- `confirm_purchase` - mock only (disabled when provider=stripe)
- Admin functions: `admin_*`

Notes:

- Stripe live path uses `STRIPE_WEBHOOK_SECRET` (Stripe signature).
- Legacy mock webhook uses `PAYMENT_WEBHOOK_SECRET` + `x-webhook-secret` header.

## 6) Stripe sandbox setup (once)

Stripe Dashboard (test mode):

- Enable payment method: Card
- Create product: "Acesso 1 dia"
- Create fixed price in your business currency
- Save:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_PUBLISHABLE_KEY`
  - `STRIPE_WEBHOOK_SECRET`

Webhook endpoint:

```
https://<project_ref>.supabase.co/functions/v1/payment_webhook
```

Events to send:

- `checkout.session.completed`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`

## 7) App envs

Create env files from examples:

- `apps/user-web/.env` from `apps/user-web/.env.example`
- `apps/admin-web/.env` from `apps/admin-web/.env.example`

Vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 8) Run locally

At repo root:

```bash
npm install
npm run dev:user
```

In another terminal:

```bash
npm run dev:admin
```

## 9) Payment model (mental model)

- Pagamento = evento externo (Stripe/webhook).
- Codigo de acesso = ativo interno.
- Regra central: um codigo so transita para `active` apos evento Stripe validado no webhook.

Payment states (Postgres):

- `created` - intencao criada
- `pending` - utilizador redirecionado / pagamento em curso
- `paid` - confirmado por webhook
- `failed` - falha definitiva
- `expired` - intent abandonado
- `refunded` - opcional pos-MVP

Regra:

- Nenhum frontend pode escrever `paid`.

## 10) Admin dashboard (payments)

Minimo:

- Listar pagamentos
- Filtrar por estado
- Ver ligacao pagamento <-> codigo
- Ver eventos Stripe associados
- Export CSV

Admins nao confirmam pagamentos manualmente.

## 11) Observability / exports

Dashboard exports CSV via Edge Functions:

- `admin_export_codes`
- `admin_export_payments`
- `admin_export_events`

Edge Functions emit JSON structured logs and include `x-request-id` on export responses.

## 12) MVP acceptance checklist

- Compra cria pagamento `pending`.
- Webhook muda para `paid`.
- Codigo e criado apenas apos webhook.
- Codigo expira automaticamente.
- Admin ve tudo.
- CSV export funciona.
- Mock e Stripe coexistem.
