# Supabase (cloud)

Supabase e a fonte unica de verdade do MVP e atua como API publica e middleware (evita dependencias de rede/firewall), mantendo regras/estados/auditoria na cloud.

## System shape (logical, not tech)

Actors:

- Public User: anonimo, via browser; compra e usa um codigo
- Admin: operador; consulta, revoga, abre portao remotamente (no MVP: so registo)
- Superadmin: controlo total do sistema; gere admins/segredos/configuracao (fora do UI do MVP)
- System: automacoes; expira por tempo (deterministico) e regista eventos

Core entities (conceito -> equivalente no MVP):

- Payment: compra + estado (created/paid/canceled)
- Access Code: codigo de acesso 6 digitos (single-use, 24h)
- Event: auditoria (todas as mudancas/acoes relevantes)
- Admin: identidade/ator privilegiado (no MVP nao ha contas; e um ator logico)

Authority:

- Todas as decisoes vivem na logica Supabase/Postgres (fonte unica de verdade).
- Frontends sao "dumb": apenas apresentam UI e chamam a API.
- Zero confianca no cliente: nada e aceite por "boa fe" do browser.

## Module execution order (mandatory)

1) Schema + invariants (entidades, estados, regras, auditoria)
2) Public API (endpoints para compra/emissao/validacao)
3) Admin API (endpoints para operar/auditar/revogar)
4) User frontend (browser) com fluxos completos ponta-a-ponta
5) Admin frontend (browser) com operacao/auditoria minima
6) Stabilization (smoke tests, erros previsiveis, docs)

## Arquitetura logica (MVP)

```text
[ User App (Browser) ] ----HTTP----> [ Supabase Edge Functions / API ] ----SQL/RPC----> [ Postgres ]

[ Admin Dashboard (Browser) ] --HTTP (Auth JWT)--> [ Supabase Edge Functions / API ] --SQL/RPC--> [ Postgres ]
```

Regras de fronteira (regra de ouro):

- User App nao conhece regras (so chama endpoints).
- Admin Dashboard nao valida codigos (so opera/observa).
- Supabase/Postgres decide tudo (cloud decide, apps executam).

## Schema

- Aplicar o SQL em `supabase/migrations/` no teu projeto Supabase (ordem por nome).

## Module 1 — Cloud Foundation (acceptance)

1) Criar um projeto Supabase e ativar:

- Postgres
- Auth (email/password apenas)
- Edge Functions

2) Aplicar a migracao `supabase/migrations/0001_cloud_foundation.sql`.

3) Seed de 1 superadmin (manual):

- Criar um utilizador em Auth (email/password).
- Copiar o `id` (UUID) do utilizador.
- Inserir na tabela `public.admins` (SQL editor):

```sql
insert into public.admins (user_id, role, active)
values ('<AUTH_USER_UUID>', 'superadmin', true)
on conflict (user_id) do update set role = excluded.role, active = excluded.active;
```

Garantias (enforced no DB):

- RLS ativo em `public.admins`, `public.payments`, `public.access_codes`, `public.events`
- Sem escrita publica (anon/authenticated nao tem policies de write)
- `public.events` e append-only (sem update/delete, mesmo para `service_role`)
- `public.access_codes` so pode ser escrito por logica server-side (`service_role` / Edge Functions)

## Module 2 — Access Code Lifecycle (acceptance)

Propriedades (enforced):

- Numerico, 6 digitos (validacao server-side)
- Single-use (nao reutilizavel)
- Validade 24h (deterministica via `valid_until`)
- Nunca armazenado em plain text (hash + ultimos 2 digitos apenas)

Estados (explicitos, deterministas):

- `issued`: emitido e ainda valido
- `used`: consumido (terminal)
- `revoked`: revogado (terminal)
- `expired`: deterministico (quando `now() > valid_until`)

Transicoes validas (enforced no DB):

- `issued -> used`
- `issued -> revoked`
- `issued -> expired` (automatico por tempo, sem job)

Bloqueios:

- Reuse: nao permite `used_at` ser definido mais de uma vez
- Resurrection: nao permite limpar `used_at`/`revoked_at` nem apagar `access_codes`
- State skipping: bloqueia `used` e `revoked` simultaneamente e bloqueia mutacoes quando expirado

Implementacao:

- Migracao: `supabase/migrations/0002_access_code_lifecycle.sql`
- Estado derivado: `public.access_codes_with_state`

## Module 4 — Payments (mock -> real) (acceptance)

Phase 1 (MVP):

- Mock confirmation e o gatekeeper para emitir codigo (pagamento confirmado -> status paid + emite codigo + log de eventos)
- Sem provider real no MVP

Phase 2 (prepared, not live):

- Campos genericos de provider em `public.payments` (ex: `provider`, `provider_payment_id`, `provider_payload`)
- Webhook idempotente preparado via `public.process_payment_webhook_event(...)` + Edge Function `payment_webhook`
- Idempotency garantida por `public.payment_provider_events` (unique `(provider, event_id)`)

Garantia principal:

- Emissao de `access_codes` so e possivel para pagamentos `paid` (trigger `access_code_requires_paid_payment`)

## Module 6 — Admin Auth + RBAC (acceptance)

Auth:

- Login via Supabase Auth (email/password)
- Roles sincronizadas a partir de `public.admins` (`admin` | `superadmin`)

RBAC (enforced no server-side):

- Admin: read-only + monitoring (usa `admin_list`)
- Superadmin: revoke, abrir portao (log), emitir codigos manuais

Garantias:

- Utilizador nao-admin recebe `401` e nao ve dados (Edge Functions verificam membership em `public.admins`)
- Escalation impossivel: nao existe write publico via RLS e as acoes privilegiadas exigem `superadmin` no server

## Module 7 — Admin Dashboard (core ops)

Funcionalidades (sem analytics/charts):

- Lista de codigos + status
- Detalhe de codigo com timeline de eventos (codigo + pagamento)
- Emissao manual de codigo (superadmin)
- Revogacao (superadmin)
- Lista de pagamentos
- Feed de eventos com filtros

Implementacao:

- Views: `public.admin_payments` (`supabase/migrations/0006_admin_ops_views.sql`)
- Edge Functions: `admin_code_detail`, `admin_payments_list`, `admin_events`

## Module 8 — Audit & Event Model

Modelo de evento (imutavel, sem ambiguidade):

- Tabela: `public.events` (append-only; sem update/delete)
- Referencias: `entity_type`, `entity_id`, `actor_type`, `actor_id`, `created_at`, `details` (snapshot)
- Timeline unificada: `public.events_timeline` (inclui eventos + `code_expired` deterministico)

Eventos canonicos (sempre emitidos para mudancas de estado):

- `purchase_started`
- `payment_confirmed`
- `code_issued`
- `code_used`
- `code_revoked`
- `code_expired` (deterministico; gerado na timeline quando `now() > valid_until`)

## Module 9 — Export + Basic Observability

CSV export (para auditoria externa):

- Codes: `admin_export_codes` (filtros: `status`, `since`, `until`)
- Payments: `admin_export_payments` (filtros: `status`, `since`, `until`)
- Events: `admin_export_events` (filtros: `entity_type`, `entity_id`, `event_type`, `since`, `until`)

Observability (Edge Functions):

- Logs estruturados (JSON) via `supabase/functions/_shared/log.ts`
- Cada export devolve header `x-request-id` para correlacao com logs

## Edge Functions

Publicas (exatamente 3 operacoes):

- `start_purchase` - start purchase (gera `purchase_token`)
- `confirm_purchase` - confirm purchase (mock/demo) e emite codigo
- `check_access_status` - consulta estado do codigo (nao muta estado)

Prepared (not live):

- `payment_webhook` - endpoint de webhook (idempotente) para confirmacao real por provider (desativado sem secret)

Admin (requerem login via Supabase Auth):

- `admin_list` - lista codigos + auditoria recente
- `admin_code_detail` - detalhe de um codigo + timeline de eventos
- `admin_payments_list` - lista pagamentos (operacional)
- `admin_events` - feed de eventos com filtros
- `admin_revoke` - revoga um codigo (superadmin)
- `admin_open_gate` - regista "abrir portao" (superadmin; sem hardware no MVP)
- `admin_issue_manual_code` - emite codigo manual (superadmin)

## Env (Edge Functions)

Configurar no Supabase:

- (nenhuma extra no MVP) Admin endpoints usam Supabase Auth (email/password).
- `PAYMENT_WEBHOOK_SECRET` (prepared): quando definido, ativa `payment_webhook` e exige header `x-webhook-secret`.
