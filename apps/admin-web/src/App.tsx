import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import type { AdminCodeDetailResponse, AdminEventsResponse, AdminListResponse, AdminPaymentsListResponse } from "./types";

function formatDateTime(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-PT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function downloadText(filename: string, contentType: string, text: string) {
  const blob = new Blob([text], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function isInvalidCredentialsError(e: unknown) {
  if (!(e instanceof Error)) return false;
  return /invalid login credentials/i.test(e.message);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

type View = "home" | "search" | "events" | "payments" | "export";

export function App() {
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");

  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [role, setRole] = useState<"admin" | "superadmin" | null>(null);
  const [serverTime, setServerTime] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loginState, setLoginState] = useState<"idle" | "invalid_credentials" | "no_role">("idle");

  const [data, setData] = useState<AdminListResponse | null>(null);
  const [view, setView] = useState<View>("home");

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedCodeId, setSelectedCodeId] = useState<string | null>(null);
  const [codeDetail, setCodeDetail] = useState<AdminCodeDetailResponse | null>(null);
  const [events, setEvents] = useState<AdminEventsResponse["events"]>([]);
  const [payments, setPayments] = useState<AdminPaymentsListResponse["payments"]>([]);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>("");
  const [paymentSince, setPaymentSince] = useState<string>("");
  const [paymentUntil, setPaymentUntil] = useState<string>("");
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("");
  const [eventCodeFilter, setEventCodeFilter] = useState<string>("");
  const [eventSince, setEventSince] = useState<string>("");
  const [eventUntil, setEventUntil] = useState<string>("");
  const [revokeModalOpen, setRevokeModalOpen] = useState<boolean>(false);
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState<string>("");
  const [exportStatus, setExportStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading"; what: "codes" | "payments" | "events" }
    | { kind: "ready"; filename: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const canQuery = useMemo(() => sessionEmail !== null && role !== null, [sessionEmail, role]);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user.email ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function signIn() {
    setBusy("sign_in");
    setMessage(null);
    setLoginState("idle");
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      setSessionEmail(data.user?.email ?? email.trim());
      setPassword("");

      setBusy("rbac_check");
      const r = await supabase.functions.invoke<AdminListResponse>("admin_list", { body: {} });
      if (r.error || !r.data?.me?.role) {
        await supabase.auth.signOut();
        setRole(null);
        setData(null);
        setServerTime(null);
        setLoginState("no_role");
        setMessage("Sem role válido (RBAC).");
        return;
      }

      setData(r.data);
      setRole(r.data.me.role ?? null);
      setServerTime(r.data.server_time ?? null);
      setView("home");
      setMessage(null);
    } catch (e) {
      if (isInvalidCredentialsError(e)) {
        setLoginState("invalid_credentials");
        setMessage("Credenciais inválidas.");
      } else {
        setMessage(e instanceof Error ? e.message : "Erro desconhecido");
      }
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    setBusy("sign_out");
    setMessage(null);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setData(null);
      setRole(null);
      setSessionEmail(null);
      setServerTime(null);
      setLoginState("idle");
      setView("home");
      setSearchQuery("");
      setSelectedCodeId(null);
      setCodeDetail(null);
      setEvents([]);
      setPayments([]);
      setPaymentStatusFilter("");
      setPaymentSince("");
      setPaymentUntil("");
      setEventTypeFilter("");
      setEventCodeFilter("");
      setEventSince("");
      setEventUntil("");
      setMessage("Sessão terminada.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    setBusy("refresh");
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke<AdminListResponse>("admin_list", { body: {} });
      if (error) throw error;
      if (!data?.codes || !data?.audit) throw new Error("Resposta inválida do servidor");
      setData(data);
      setRole(data.me?.role ?? null);
      setServerTime(data.server_time ?? null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro desconhecido");
      setData(null);
      setRole(null);
      setServerTime(null);
    } finally {
      setBusy(null);
    }
  }

  async function loadEventsTimeline() {
    setBusy("events");
    setMessage(null);
    try {
      const body: any = { limit: 200 };
      const type = eventTypeFilter.trim();
      const codeFilter = eventCodeFilter.trim();
      const since = eventSince.trim();
      const until = eventUntil.trim();

      if (type) body.event_type = type;
      if (since) body.since = since;
      if (until) body.until = until;

      if (codeFilter) {
        body.entity_type = "access_code";
        if (/^[0-9]{6}$/.test(codeFilter)) body.code = codeFilter;
        else if (isUuid(codeFilter)) body.entity_id = codeFilter;
        else throw new Error("Filtro de código inválido: usar 6 dígitos ou code_id (UUID).");
      }

      const { data, error } = await supabase.functions.invoke<AdminEventsResponse>("admin_events", { body });
      if (error) throw error;
      if (!data?.events) throw new Error("Resposta inválida do servidor");

      setEvents(data.events);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro desconhecido");
      setEvents([]);
    } finally {
      setBusy(null);
    }
  }

  async function loadPayments() {
    setBusy("payments");
    setMessage(null);
    try {
      const body: any = { limit: 200 };
      const status = paymentStatusFilter.trim();
      const since = paymentSince.trim();
      const until = paymentUntil.trim();
      if (status) body.status = status;
      if (since) body.since = since;
      if (until) body.until = until;

      const { data, error } = await supabase.functions.invoke<AdminPaymentsListResponse>("admin_payments_list", {
        body,
      });
      if (error) throw error;
      if (!data?.payments) throw new Error("Resposta inv lida do servidor");
      setPayments(data.payments);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro desconhecido");
      setPayments([]);
    } finally {
      setBusy(null);
    }
  }

  async function loadCodeDetail(codeId: string) {
    setBusy(`code_detail:${codeId}`);
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke<AdminCodeDetailResponse>("admin_code_detail", {
        body: { code_id: codeId },
      });
      if (error) throw error;
      if (!data?.code || !data?.events) throw new Error("Resposta inválida do servidor");
      setSelectedCodeId(codeId);
      setCodeDetail(data);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro desconhecido");
      setSelectedCodeId(codeId);
      setCodeDetail(null);
    } finally {
      setBusy(null);
    }
  }

  async function revoke(codeId: string, reason: string) {
    setBusy(`revoke:${codeId}`);
    setMessage(null);
    try {
      const { error } = await supabase.functions.invoke("admin_revoke", {
        body: { code_id: codeId, reason },
      });
      if (error) throw error;
      await refresh();
      if (selectedCodeId === codeId) await loadCodeDetail(codeId);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setBusy(null);
    }
  }

  function paymentOriginLabel(payment: AdminCodeDetailResponse["payment"]) {
    if (!payment) return "-";
    if (payment.confirmed_via === "mock") return "mock";
    if (payment.confirmed_via === "webhook") return "real";
    if (payment.confirmed_via === "manual") return "manual";
    return payment.confirmed_via ?? "-";
  }

  async function exportCsv(functionName: string, filename: string, body: any) {
    const what: "codes" | "payments" | "events" =
      functionName === "admin_export_codes"
        ? "codes"
        : functionName === "admin_export_payments"
          ? "payments"
          : "events";
    setBusy(`export:${functionName}`);
    setMessage(null);
    setExportStatus({ kind: "loading", what });
    try {
      const { data, error } = await supabase.functions.invoke(functionName, { body });
      if (error) throw error;
      downloadText(filename, "text/csv;charset=utf-8", data as string);
      setExportStatus({ kind: "ready", filename });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      setMessage(msg);
      setExportStatus({ kind: "error", message: msg });
    } finally {
      setBusy(null);
    }
  }

  const todayKey = (serverTime ?? new Date().toISOString()).slice(0, 10);
  const activeCodes = data ? data.codes.filter((c) => c.code_status === "issued").length : 0;
  const expiredToday =
    data?.audit?.filter((e) => e.event_type === "code_expired" && e.created_at.slice(0, 10) === todayKey).length ?? 0;
  const revokedToday =
    data?.audit?.filter((e) => e.event_type === "code_revoked" && e.created_at.slice(0, 10) === todayKey).length ?? 0;

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1>BT Admin</h1>
          <p className="muted">Core Ops (dashboard mínimo).</p>
        </div>
        {role ? (
          <div className="row">
            <div className="mono">{sessionEmail}</div>
            <div className="mono">{role}</div>
            <button onClick={signOut} disabled={busy !== null} className="danger">
              Logout
            </button>
          </div>
        ) : null}
      </header>

      {sessionEmail === null ? (
        <section className="card">
          <h2>Login</h2>
          <div className="row">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email"
              autoComplete="username"
              disabled={busy !== null}
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
              type="password"
              autoComplete="current-password"
              disabled={busy !== null}
            />
            <button onClick={signIn} disabled={busy !== null}>
              Login
            </button>
          </div>
          {busy ? <div className="mono">Loading: {busy}</div> : null}
          {loginState === "invalid_credentials" ? <div className="mono">Credenciais inválidas.</div> : null}
          {message ? <div className="mono">{message}</div> : null}
          <div className="muted" style={{ marginTop: 10 }}>
            Sem “lembrar sessão” no MVP: ao refrescar a página, voltas a autenticar.
          </div>
        </section>
      ) : null}

      {sessionEmail !== null && role === null ? (
        <section className="card">
          <h2>RBAC</h2>
          {busy ? <div className="mono">Loading: {busy}</div> : null}
          {loginState === "no_role" ? <div className="mono">Sem role válido (RBAC).</div> : null}
          {message ? <div className="mono">{message}</div> : null}
          <div className="mono">Sessão: {sessionEmail}</div>
          <div className="row" style={{ marginTop: 10 }}>
            <button onClick={signOut} disabled={busy !== null} className="danger">
              Sair
            </button>
          </div>
        </section>
      ) : null}

      {role ? (
        <>
          {message ? (
            <section className="card">
              <div className="mono">{message}</div>
            </section>
          ) : null}

          <section className="card">
            <h2>Dashboard</h2>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="mono">Server time: {formatDateTime(serverTime)}</div>
              <button onClick={refresh} disabled={!canQuery || busy !== null}>
                Atualizar
              </button>
            </div>

            <div className="grid2" style={{ marginTop: 12 }}>
              <div>
                <div className="label">Códigos ativos</div>
                <div className="mono">{activeCodes}</div>
              </div>
              <div>
                <div className="label">Códigos expirados hoje</div>
                <div className="mono">{expiredToday}</div>
              </div>
              <div>
                <div className="label">Revogações</div>
                <div className="mono">{revokedToday}</div>
              </div>
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <button onClick={() => setView("search")} disabled={busy !== null}>
                Procurar código
              </button>
              <button onClick={() => setView("payments")} disabled={busy !== null}>
                Pagamentos
              </button>
              <button onClick={() => setView("events")} disabled={busy !== null}>
                Ver eventos
              </button>
              <button onClick={() => setView("export")} disabled={busy !== null}>
                Exportar
              </button>
            </div>
          </section>

          {view === "search" ? (
            <section className="card">
              <h2>Procurar código</h2>
              <div className="row">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="code_id | purchase_id | **last2"
                  autoComplete="off"
                  disabled={busy !== null}
                />
                <button
                  onClick={() => {
                    setSelectedCodeId(null);
                    setCodeDetail(null);
                  }}
                  disabled={busy !== null}
                  className="secondary"
                >
                  Limpar seleção
                </button>
                <button onClick={() => setView("home")} disabled={busy !== null} className="secondary">
                  Voltar
                </button>
              </div>

              {data ? (
                (() => {
                  const q = searchQuery.trim();
                  if (!q) return <div className="mono">Introduz um identificador para procurar.</div>;
                  const qDigits = q.replace(/\\D/g, "");
                  const matches = data.codes
                    .filter((c) => {
                      if (isUuid(q)) return c.code_id === q || c.purchase_id === q;
                      if (qDigits.length === 2) return c.code_last2 === qDigits;
                      return c.code_id.includes(q) || c.purchase_id.includes(q);
                    })
                    .slice(0, 20);

                  if (matches.length === 0) return <div className="mono">NOT_FOUND</div>;
                  return (
                    <table>
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Code</th>
                          <th>Valid until</th>
                          <th>Purchase</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {matches.map((c) => (
                          <tr key={c.code_id}>
                            <td className="mono">{c.code_status}</td>
                            <td className="mono">**{c.code_last2}</td>
                            <td className="mono">{formatDateTime(c.valid_until)}</td>
                            <td className="mono">{c.purchase_id}</td>
                            <td>
                              <button onClick={() => loadCodeDetail(c.code_id)} disabled={busy !== null} className="link">
                                detalhe
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()
              ) : (
                <div className="mono">Sem dados. Carrega em “Atualizar”.</div>
              )}

              {selectedCodeId ? (
                <section className="card">
                  <h2>Detalhe do código</h2>
                  {codeDetail?.code ? (
                    <>
                      <div className="grid2">
                        <div>
                          <div className="label">Código completo</div>
                          <div className="mono">
                            {codeDetail.code.code_plaintext ? codeDetail.code.code_plaintext : "INDISPONÍVEL (não armazenado)"}
                          </div>
                        </div>
                        <div>
                          <div className="label">Estado atual</div>
                          <div className="mono">{codeDetail.code.code_status}</div>
                        </div>
                        <div>
                          <div className="label">Criado</div>
                          <div className="mono">{formatDateTime(codeDetail.code.issued_at)}</div>
                        </div>
                        <div>
                          <div className="label">Ativado</div>
                          <div className="mono">{formatDateTime(codeDetail.code.used_at)}</div>
                        </div>
                        <div>
                          <div className="label">Expira (determinístico)</div>
                          <div className="mono">{formatDateTime(codeDetail.code.valid_until)}</div>
                        </div>
                        <div>
                          <div className="label">Origem do pagamento</div>
                          <div className="mono">{paymentOriginLabel(codeDetail.payment)}</div>
                        </div>
                      </div>

                      <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
                        <div className="mono">
                          Purchase ID: {codeDetail.code.purchase_id}
                          {"\n"}Code ID: {codeDetail.code.code_id}
                        </div>
                        <span className={`status ${codeDetail.code.code_status === "issued" ? "ok" : codeDetail.code.code_status === "expired" ? "warn" : "bad"}`}>
                          {codeDetail.code.code_status}
                        </span>
                      </div>

                      <section className="card">
                        <h2>Histórico (resumo)</h2>
                        {codeDetail.events?.length ? (
                          <table>
                            <thead>
                              <tr>
                                <th>Quando</th>
                                <th>Evento</th>
                                <th>Entidade</th>
                                <th>Syn</th>
                              </tr>
                            </thead>
                            <tbody>
                              {codeDetail.events
                                .slice(-12)
                                .map((e) => (
                                  <tr key={e.event_id}>
                                    <td className="mono">{formatDateTime(e.created_at)}</td>
                                    <td className="mono">{e.event_type}</td>
                                    <td className="mono">
                                      {e.entity_type}:{e.entity_id ?? "-"}
                                    </td>
                                    <td className="mono">{e.synthetic ? "Y" : "-"}</td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="mono">Sem eventos.</div>
                        )}
                      </section>

                      <div className="row" style={{ marginTop: 10 }}>
                        <button
                          className="danger"
                          onClick={() => {
                            setRevokeTargetId(codeDetail.code.code_id);
                            setRevokeReason("");
                            setRevokeModalOpen(true);
                          }}
                          disabled={busy !== null || role !== "superadmin"}
                          title={role === "superadmin" ? "" : "Apenas superadmin"}
                        >
                          Revogar
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="mono">Sem detalhe (ou sem permissões).</div>
                  )}
                </section>
              ) : null}
            </section>
          ) : null}

          {revokeModalOpen ? (
            <div className="modalOverlay" role="presentation" onMouseDown={() => setRevokeModalOpen(false)}>
              <div className="modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
                <div className="modalHeader">
                  <h2 style={{ margin: 0 }}>Confirmar revogação</h2>
                  <button onClick={() => setRevokeModalOpen(false)} disabled={busy !== null} className="secondary">
                    Fechar
                  </button>
                </div>
                <p className="muted">
                  Ação destrutiva. Não existe edição manual de estado. Após confirmar, a UI faz refresh via backend.
                </p>
                <div className="row">
                  <input
                    value={revokeReason}
                    onChange={(e) => setRevokeReason(e.target.value)}
                    placeholder="Motivo (opcional)"
                    autoComplete="off"
                    disabled={busy !== null}
                  />
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  <button
                    className="danger"
                    disabled={busy !== null || !revokeTargetId}
                    onClick={async () => {
                      if (!revokeTargetId) return;
                      setRevokeModalOpen(false);
                      await revoke(revokeTargetId, revokeReason);
                      await refresh();
                      await loadCodeDetail(revokeTargetId);
                      setRevokeTargetId(null);
                      setRevokeReason("");
                    }}
                  >
                    Confirmar revogação
                  </button>
                  <button
                    onClick={() => setRevokeModalOpen(false)}
                    disabled={busy !== null}
                    className="secondary"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          ) : null}


          {view === "payments" ? (
            <section className="card">
              <h2>Pagamentos</h2>
              <p className="muted">Read-only. Pagamentos so mudam via webhook.</p>

              <div className="row" style={{ marginBottom: 10 }}>
                <input
                  value={paymentStatusFilter}
                  onChange={(e) => setPaymentStatusFilter(e.target.value)}
                  placeholder="status (ex: paid, pending, failed)"
                  autoComplete="off"
                  disabled={busy !== null}
                />
                <input
                  value={paymentSince}
                  onChange={(e) => setPaymentSince(e.target.value)}
                  placeholder="since (ISO, opcional)"
                  autoComplete="off"
                  disabled={busy !== null}
                />
                <input
                  value={paymentUntil}
                  onChange={(e) => setPaymentUntil(e.target.value)}
                  placeholder="until (ISO, opcional)"
                  autoComplete="off"
                  disabled={busy !== null}
                />
                <button onClick={loadPayments} disabled={!canQuery || busy !== null}>
                  Aplicar filtros
                </button>
                <button
                  onClick={() => {
                    setPaymentStatusFilter("");
                    setPaymentSince("");
                    setPaymentUntil("");
                    setPayments([]);
                  }}
                  disabled={busy !== null}
                  className="secondary"
                >
                  Limpar
                </button>
                <button onClick={() => setView("home")} disabled={busy !== null} className="secondary">
                  Voltar
                </button>
              </div>

              {busy === "payments" ? <div className="mono">Loading: payments</div> : null}

              {payments.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Quando</th>
                      <th>Valor</th>
                      <th>Provider</th>
                      <th>Payment ID</th>
                      <th>Code</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.payment_id}>
                        <td className="mono">{p.status}</td>
                        <td className="mono">{formatDateTime(p.created_at)}</td>
                        <td className="mono">
                          {(p.amount_cents / 100).toFixed(2)} {p.currency}
                        </td>
                        <td className="mono">{p.provider ?? "-"}</td>
                        <td className="mono">{p.provider_payment_id ?? p.payment_id}</td>
                        <td className="mono">{p.access_code_id ?? "-"}</td>
                        <td>
                          <button
                            onClick={async () => {
                              setEventTypeFilter("");
                              setEventCodeFilter("");
                              setEventSince("");
                              setEventUntil("");
                              setView("events");
                              const { data, error } = await supabase.functions.invoke<AdminEventsResponse>("admin_events", {
                                body: { entity_type: "payment", entity_id: p.payment_id, limit: 200 },
                              });
                              if (!error && data?.events) setEvents(data.events);
                            }}
                            disabled={busy !== null}
                            className="link"
                          >
                            eventos
                          </button>
                          {p.access_code_id ? (
                            <button onClick={() => loadCodeDetail(p.access_code_id)} disabled={busy !== null} className="link">
                              codigo
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="mono">Sem pagamentos (nao carregado).</div>
              )}
            </section>
          ) : null}

          {view === "events" ? (
            <section className="card">
              <h2>Timeline de eventos (read-only)</h2>
              <p className="muted">Ordem é definida pelo backend (não manipulável no frontend).</p>

              <div className="row" style={{ marginBottom: 10 }}>
                <input
                  value={eventTypeFilter}
                  onChange={(e) => setEventTypeFilter(e.target.value)}
                  placeholder="tipo de evento (ex: code_revoked)"
                  autoComplete="off"
                  disabled={busy !== null}
                />
                <input
                  value={eventCodeFilter}
                  onChange={(e) => setEventCodeFilter(e.target.value)}
                  placeholder="código (6 dígitos) ou code_id (UUID)"
                  autoComplete="off"
                  disabled={busy !== null}
                />
                <input
                  value={eventSince}
                  onChange={(e) => setEventSince(e.target.value)}
                  placeholder="since (ISO, opcional)"
                  autoComplete="off"
                  disabled={busy !== null}
                />
                <input
                  value={eventUntil}
                  onChange={(e) => setEventUntil(e.target.value)}
                  placeholder="until (ISO, opcional)"
                  autoComplete="off"
                  disabled={busy !== null}
                />
                <button onClick={loadEventsTimeline} disabled={!canQuery || busy !== null}>
                  Aplicar filtros
                </button>
                <button
                  onClick={() => {
                    setEventTypeFilter("");
                    setEventCodeFilter("");
                    setEventSince("");
                    setEventUntil("");
                    setEvents([]);
                  }}
                  disabled={busy !== null}
                  className="secondary"
                >
                  Limpar
                </button>
                <button onClick={() => setView("home")} disabled={busy !== null} className="secondary">
                  Voltar
                </button>
              </div>

              {busy === "events" ? <div className="mono">Loading: events</div> : null}

              {events.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Tipo</th>
                      <th>Origem</th>
                      <th>Entidade</th>
                      <th>Metadata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.event_id}>
                        <td className="mono">{formatDateTime(e.created_at)}</td>
                        <td className="mono">{e.event_type}</td>
                        <td className="mono">{e.actor_type}</td>
                        <td className="mono">
                          {e.entity_type}:{e.entity_id ?? "-"}
                          {e.synthetic ? " (synthetic)" : ""}
                        </td>
                        <td className="mono">
                          {(() => {
                            try {
                              const s = JSON.stringify(e.details);
                              return s.length > 160 ? `${s.slice(0, 160)}…` : s;
                            } catch {
                              return "-";
                            }
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="mono">No events (not loaded).</div>
              )}
            </section>
          ) : null}

          {view === "export" ? (
            <section className="card">
              <h2>Exports</h2>
              <div className="row">
                <button onClick={() => exportCsv("admin_export_codes", "codes.csv", {})} disabled={!canQuery || busy !== null}>
                  Export Codes
                </button>
                <button
                  onClick={() => exportCsv("admin_export_events", "events.csv", {})}
                  disabled={!canQuery || busy !== null}
                >
                  Export Events
                </button>
                <button
                  onClick={() => exportCsv("admin_export_payments", "payments.csv", {})}
                  disabled={!canQuery || busy !== null}
                >
                  Export Payments
                </button>
                <button onClick={() => setView("home")} disabled={busy !== null} className="secondary">
                  Voltar
                </button>
              </div>
              <div className="mono" style={{ marginTop: 10 }}>
                {exportStatus.kind === "idle" ? "Ready (no preview in MVP)." : null}
                {exportStatus.kind === "loading" ? "Loading..." : null}
                {exportStatus.kind === "ready" ? `Download ready: ${exportStatus.filename}` : null}
                {exportStatus.kind === "error" ? `Error: ${exportStatus.message}` : null}
              </div>
              {exportStatus.kind !== "idle" ? (
                <div className="row" style={{ marginTop: 10 }}>
                  <button
                    onClick={() => setExportStatus({ kind: "idle" })}
                    disabled={busy !== null}
                    className="secondary"
                  >
                    Clear
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
