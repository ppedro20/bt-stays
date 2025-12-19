# bt-stays-supabase (MVP)

MVP de controlo de acessos por codigo (6 digitos), com regras decididas na cloud (Supabase) e apps web (browser).

## Repo structure (non-optional)

- `apps/user-web`
- `apps/admin-web`
- `supabase`
- `packages/shared`

Guia completo de setup/run: `RUNBOOK.md`.

## MVP frame (non-negotiables)

Objetivo:

- Utilizador compra acesso de 1 dia
- Recebe um codigo numerico de 6 digitos
- Codigo e validado online via cloud
- Admins conseguem operar, auditar e revogar
- Sistema simples, deterministico e extensivel

Hard constraints (fora do scope do MVP):

- Sem offline edge
- Sem hardware/rele
- Sem app mobile instalada
- Sem camaras
- Sem contas de utilizador
- Sem QR (apenas preparado para evoluir)
- Supabase e a single source of truth

## Payment model (mental model)

- Pagamento = evento externo (Stripe/webhook).
- Codigo de acesso = ativo interno.
- Regra central: um codigo so transita para `active` apos evento Stripe validado no webhook.

## System shape (logical, not tech)

Actors:

- Public User (anonimo, browser)
- Admin (operacao + auditoria + revogacao)
- Superadmin (controlo total; fora do UI do MVP)
- System (automacoes; expiracao deterministica + eventos)

Authority:

- Todas as decisoes vivem na logica Supabase/Postgres.
- Frontends sao "dumb" e nao sao confiaveis.

## UI/UX (não negociáveis)

- Frontends são stateless, descartáveis, não confiáveis.
- Toda a UI reflete estado vindo do Supabase (nunca decisões locais/persistência local).
- UX determinística: mesmo input → mesmo output (sem “inteligência” no cliente).
- Erros sempre explícitos (mensagem vinda da API), sem retries mágicos.
- UI preparada para auditoria humana.

## Module A — Design System Base (antes de qualquer ecrã)

- Fonte: `packages/shared/src/ui/`
- Estilos/tokens: `packages/shared/src/ui/styles.css` (paleta neutra + 1 primária + erro + sucesso)
- Componentes mínimos: `Button`, `InputCode6`, `StatusBadge`, `Table`, `Modal`, `Toast`
- Estados globais: `BlockingLoading`, `ErrorState`, `EmptyState`
- Preview manual (user-web): abrir `apps/user-web` e navegar para `#/ds`

## Module execution order (mandatory)

1) Schema + regras + auditoria
2) Public API
3) Admin API
4) User App
5) Admin Dashboard
6) Stabilization + docs

## Module 1 (Cloud Foundation)

- Migracao: `supabase/migrations/0001_cloud_foundation.sql`
- Seed superadmin: ver `supabase/README.md`

## Module 2 (Access Code Lifecycle)

- Migracao: `supabase/migrations/0002_access_code_lifecycle.sql`
- Estados/Transicoes: ver `supabase/README.md`

## Module 4 (Payments: mock -> real)

- Migracao: `supabase/migrations/0004_payments_mock_real.sql`
- Webhook preparado (nao live): `supabase/functions/payment_webhook/index.ts`

## Module 6 (Admin Auth + RBAC)

- Migracao: `supabase/migrations/0005_admin_rbac.sql`
- Admin login: Supabase Auth + roles em `public.admins`

## Module 7 (Admin Dashboard: core ops)

- Views: `supabase/migrations/0006_admin_ops_views.sql`
- Ops APIs: `supabase/functions/admin_code_detail/index.ts`, `supabase/functions/admin_payments_list/index.ts`, `supabase/functions/admin_events/index.ts`

## Module 8 (Audit & Event Model)

- Migracao: `supabase/migrations/0007_audit_event_model.sql`
- Timeline: `public.events_timeline` (inclui `code_expired` deterministico)

## Module 9 (Export + Observability)

- Exports CSV (admin): `supabase/functions/admin_export_codes/index.ts`, `supabase/functions/admin_export_payments/index.ts`, `supabase/functions/admin_export_events/index.ts`
- Logging estruturado (Edge Functions): `supabase/functions/_shared/log.ts`

## Arquitetura logica (MVP)

```text
[ User App (Browser) ] ----HTTP----> [ Supabase Edge Functions / API ] ----SQL/RPC----> [ Postgres ]

[ Admin Dashboard (Browser) ] --HTTP (Auth JWT)--> [ Supabase Edge Functions / API ] --SQL/RPC--> [ Postgres ]
```

Supabase atua como:

- API publica
- Autenticacao de admins (Supabase Auth: email/password)
- Fonte unica de verdade (Postgres + RPCs)
- Middleware sem problemas de firewall

## Componentes

- `supabase/`: schema SQL + Edge Functions (cloud decide tudo)
- `apps/user-web/`: User Web App (browser) - compra (demo) + mostra codigo + consulta estado online
- `apps/admin-web/`: Admin Web Dashboard (browser) - core ops + auditoria + export CSV
- `packages/shared/`: utilitarios partilhados (tipos/helpers)

## Requisitos

- Node.js 20+ (recomendado)
- Projeto Supabase com:
  - migracao SQL aplicada (`supabase/migrations/`)
  - Edge Functions publicadas (`supabase/functions/`)

## Variaveis de ambiente (apps)

Criar `apps/user-web/.env` e `apps/admin-web/.env` (ver `.env.example` em cada app).

## Dev (apps)

```bash
npm install
npm run dev:user
```

Noutro terminal:

```bash
npm run dev:admin
```
