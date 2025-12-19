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

function statusClass(codeStatus: string) {
  if (codeStatus === "issued") return "ok";
  if (codeStatus === "expired") return "warn";
  return "bad";
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

export function App() {
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [data, setData] = useState<AdminListResponse | null>(null);
  const [role, setRole] = useState<"admin" | "superadmin" | null>(null);
  const [tab, setTab] = useState<"codes" | "payments" | "events">("codes");
  const [selectedCodeId, setSelectedCodeId] = useState<string | null>(null);
  const [codeDetail, setCodeDetail] = useState<AdminCodeDetailResponse | null>(null);
  const [payments, setPayments] = useState<AdminPaymentsListResponse["payments"]>([]);
  const [events, setEvents] = useState<AdminEventsResponse["events"]>([]);
  const [eventEntityType, setEventEntityType] = useState<string>("");
  const [eventEntityId, setEventEntityId] = useState<string>("");
  const [eventTypeQuery, setEventTypeQuery] = useState<string>("");
  const [eventSince, setEventSince] = useState<string>("");
  const [eventUntil, setEventUntil] = useState<string>("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>("");
  const [codeStatusFilter, setCodeStatusFilter] = useState<string>("");
  const [sinceFilter, setSinceFilter] = useState<string>("");
  const [untilFilter, setUntilFilter] = useState<string>("");

  const canQuery = useMemo(() => sessionEmail !== null, [sessionEmail]);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    supabase.auth.getSession().then(({ data }) => {
      setSessionEmail(data.session?.user.email ?? null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user.email ?? null);
    });
    unsub = () => data.subscription.unsubscribe();
    return () => unsub?.();
  }, []);

  async function signIn() {
    setBusy("sign_in");
    setMessage(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      setPassword("");
      setMessage("Sessao iniciada.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro desconhecido");
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
      setMessage("Sessao terminada.");
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
      const { data, error } = await supabase.functions.invoke<AdminListResponse>("admin_list", {
        body: {},
      });
      if (error) throw error;
      if (!data?.codes || !data?.audit) throw new Error("Resposta invalida do servidor");
      setData(data);
      setRole(data.me?.role ?? null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro desconhecido");
      setData(null);
      setRole(null);
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
      if (!data?.code || !data?.events) throw new Error("Resposta invalida do servidor");
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

  async function loadPayments() {
    setBusy("payments");
    setMessage(null);
    try {
      const body: any = { limit: 200 };
      if (paymentStatusFilter.trim()) body.status = paymentStatusFilter.trim();
      const { data, error } = await supabase.functions.invoke<AdminPaymentsListResponse>("admin_payments_list", { body });
      if (error) throw error;
      if (!data?.payments) throw new Error("Resposta invalida do servidor");
      setPayments(data.payments);
      setRole((prev) => prev ?? data.me?.role ?? null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro desconhecido");
      setPayments([]);
    } finally {
      setBusy(null);
    }
  }

  async function loadEvents() {
    setBusy("events");
    setMessage(null);
    try {
      const body: any = { limit: 200 };
      if (eventEntityType.trim()) body.entity_type = eventEntityType.trim();
      if (eventEntityId.trim()) body.entity_id = eventEntityId.trim();
      if (eventTypeQuery.trim()) body.event_type = eventTypeQuery.trim();
      if (eventSince.trim()) body.since = eventSince.trim();
      if (eventUntil.trim()) body.until = eventUntil.trim();

      const { data, error } = await supabase.functions.invoke<AdminEventsResponse>("admin_events", { body });
      if (error) throw error;
      if (!data?.events) throw new Error("Resposta invalida do servidor");
      setEvents(data.events);
      setRole((prev) => prev ?? data.me?.role ?? null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro desconhecido");
      setEvents([]);
    } finally {
      setBusy(null);
    }
  }

  async function revoke(codeId: string) {
    const reason = prompt("Motivo (opcional):") ?? "";
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

  async function openGate() {
    setBusy("open_gate");
    setMessage(null);
    try {
      const { error } = await supabase.functions.invoke("admin_open_gate", {
        body: {},
      });
      if (error) throw error;
      await refresh();
      setMessage("Evento registado: abrir portao (remoto).");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setBusy(null);
    }
  }

  async function issueManualCode() {
    const note = prompt("Nota (opcional):") ?? "";
    setBusy("issue_manual_code");
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke("admin_issue_manual_code", {
        body: { validity_hours: 24, note },
      });
      if (error) throw error;
      const code = (data as any)?.result?.access_code as string | undefined;
      const validUntil = (data as any)?.result?.valid_until as string | undefined;
      if (!code) throw new Error("Resposta invalida do servidor");
      setMessage(`Codigo manual: ${code} (valido ate ${formatDateTime(validUntil ?? null)})`);
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setBusy(null);
    }
  }

  async function exportCsv(functionName: string, filename: string, body: any) {
    setBusy(`export:${functionName}`);
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke(functionName, { body });
      if (error) throw error;
      downloadText(filename, "text/csv;charset=utf-8", data as string);
      setMessage(`Export OK: ${filename}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1>BT Admin</h1>
          <p className="muted">MVP - administracao basica + auditoria minima.</p>
        </div>
        <div className="row">
          <button
            onClick={openGate}
            disabled={!canQuery || busy !== null || role !== "superadmin"}
            title={role === "superadmin" ? "" : "Apenas superadmin"}
          >
            Abrir portao (log)
          </button>
          <button
            onClick={issueManualCode}
            disabled={!canQuery || busy !== null || role !== "superadmin"}
            title={role === "superadmin" ? "" : "Apenas superadmin"}
          >
            Emitir codigo manual
          </button>
          <button onClick={refresh} disabled={!canQuery || busy !== null}>
            Atualizar
          </button>
        </div>
      </header>

      <section className="card">
        <h2>Login</h2>
        <p className="muted">
          Autenticacao via Supabase Auth (email/password). O utilizador tem de existir em{" "}
          <span className="mono">public.admins</span>.
        </p>
        <div className="row">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
            autoComplete="username"
            disabled={busy !== null || sessionEmail !== null}
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
            type="password"
            autoComplete="current-password"
            disabled={busy !== null || sessionEmail !== null}
          />
          <button onClick={signIn} disabled={busy !== null || sessionEmail !== null}>
            Entrar
          </button>
          <button onClick={signOut} disabled={busy !== null || sessionEmail === null} className="danger">
            Sair
          </button>
        </div>
        <div className="mono">Sessao: {sessionEmail ?? "-"}</div>
        <div className="mono">Role: {role ?? "-"}</div>
      </section>

      <section className="card">
        <div className="row">
          <button
            onClick={() => {
              setTab("codes");
            }}
            disabled={busy !== null}
          >
            Codigos
          </button>
          <button
            onClick={async () => {
              setTab("payments");
              await loadPayments();
            }}
            disabled={!canQuery || busy !== null}
          >
            Pagamentos
          </button>
          <button
            onClick={async () => {
              setTab("events");
              await loadEvents();
            }}
            disabled={!canQuery || busy !== null}
          >
            Eventos
          </button>
        </div>
      </section>

      {message ? (
        <section className="card">
          <div className="mono">{message}</div>
        </section>
      ) : null}

      {tab === "codes" ? (
        <>
          <section className="card">
            <h2>Codigos</h2>
            <p className="muted">Mostra apenas ** (ultimos 2 digitos) para reduzir exposicao.</p>
            <div className="row" style={{ marginBottom: 10 }}>
              <input
                value={codeStatusFilter}
                onChange={(e) => setCodeStatusFilter(e.target.value)}
                placeholder="status (issued/used/revoked/expired)"
                autoComplete="off"
              />
              <input
                value={sinceFilter}
                onChange={(e) => setSinceFilter(e.target.value)}
                placeholder="since (ISO, opcional)"
                autoComplete="off"
              />
              <input
                value={untilFilter}
                onChange={(e) => setUntilFilter(e.target.value)}
                placeholder="until (ISO, opcional)"
                autoComplete="off"
              />
              <button
                onClick={() =>
                  exportCsv("admin_export_codes", "codes.csv", {
                    status: codeStatusFilter.trim() || undefined,
                    since: sinceFilter.trim() || undefined,
                    until: untilFilter.trim() || undefined,
                  })
                }
                disabled={!canQuery || busy !== null}
              >
                Export CSV
              </button>
            </div>
            {data?.codes?.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Codigo</th>
                    <th>Payment</th>
                    <th>Validade</th>
                    <th>Uso</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.codes.map((c) => (
                    <tr key={c.code_id}>
                      <td>
                        <span className={`status ${statusClass(c.code_status)}`}>{c.code_status}</span>
                      </td>
                      <td className="mono">
                        <button
                          className="link"
                          onClick={() => loadCodeDetail(c.code_id)}
                          disabled={busy !== null}
                          title="Ver detalhe"
                        >
                          **{c.code_last2}
                        </button>
                      </td>
                      <td className="mono">{c.purchase_id}</td>
                      <td className="mono">{formatDateTime(c.valid_until)}</td>
                      <td className="mono">{c.used_at ? formatDateTime(c.used_at) : "-"}</td>
                      <td>
                        <button
                          className="danger"
                          onClick={() => revoke(c.code_id)}
                          disabled={busy !== null || role !== "superadmin"}
                          title={role === "superadmin" ? "" : "Apenas superadmin"}
                        >
                          Revogar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="mono">{canQuery ? "Sem dados (ainda)." : "Faz login e atualiza."}</div>
            )}
          </section>

          {selectedCodeId ? (
            <section className="card">
              <h2>Detalhe do codigo</h2>
              {codeDetail?.code ? (
                <>
                  <div className="grid2">
                    <div>
                      <div className="label">Code ID</div>
                      <div className="mono">{codeDetail.code.code_id}</div>
                    </div>
                    <div>
                      <div className="label">Payment ID</div>
                      <div className="mono">{codeDetail.code.purchase_id}</div>
                    </div>
                    <div>
                      <div className="label">Status</div>
                      <div className="mono">{codeDetail.code.code_status}</div>
                    </div>
                    <div>
                      <div className="label">Valid until</div>
                      <div className="mono">{formatDateTime(codeDetail.code.valid_until)}</div>
                    </div>
                    <div>
                      <div className="label">Used at</div>
                      <div className="mono">{formatDateTime(codeDetail.code.used_at)}</div>
                    </div>
                    <div>
                      <div className="label">Revoked at</div>
                      <div className="mono">{formatDateTime(codeDetail.code.revoked_at)}</div>
                    </div>
                  </div>

                  <div className="row" style={{ marginTop: 10 }}>
                    <button
                      className="danger"
                      onClick={() => revoke(codeDetail.code.code_id)}
                      disabled={busy !== null || role !== "superadmin"}
                      title={role === "superadmin" ? "" : "Apenas superadmin"}
                    >
                      Revogar
                    </button>
                    <button
                      onClick={async () => {
                        setTab("events");
                        setEventEntityType("access_code");
                        setEventEntityId(codeDetail.code.code_id);
                        await loadEvents();
                      }}
                      disabled={!canQuery || busy !== null}
                    >
                      Abrir eventos (filtro)
                    </button>
                    <button onClick={() => setSelectedCodeId(null)} disabled={busy !== null} className="secondary">
                      Fechar
                    </button>
                  </div>

                  <h3>Timeline</h3>
                  {codeDetail.events?.length ? (
                    <table>
                      <thead>
                        <tr>
                          <th>Quando</th>
                          <th>Evento</th>
                          <th>Entidade</th>
                          <th>Actor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {codeDetail.events.map((a) => (
                          <tr key={a.event_id}>
                            <td className="mono">{formatDateTime(a.created_at)}</td>
                            <td className="mono">{a.event_type}</td>
                            <td className="mono">
                              {a.entity_type}:{a.entity_id ?? "-"}
                            </td>
                            <td className="mono">{a.actor_type}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="mono">Sem eventos.</div>
                  )}
                </>
              ) : (
                <div className="mono">A carregar / sem dados.</div>
              )}
            </section>
          ) : null}
        </>
      ) : null}

      {tab === "payments" ? (
        <section className="card">
          <h2>Pagamentos</h2>
          <p className="muted">Lista operacional (sem dados sensiveis como tokens).</p>
          <div className="row" style={{ marginBottom: 10 }}>
            <input
              value={paymentStatusFilter}
              onChange={(e) => setPaymentStatusFilter(e.target.value)}
              placeholder="status (created/paid/canceled)"
              autoComplete="off"
            />
            <button onClick={loadPayments} disabled={!canQuery || busy !== null}>
              Aplicar
            </button>
            <button
              onClick={() =>
                exportCsv("admin_export_payments", "payments.csv", {
                  status: paymentStatusFilter.trim() || undefined,
                  since: sinceFilter.trim() || undefined,
                  until: untilFilter.trim() || undefined,
                })
              }
              disabled={!canQuery || busy !== null}
            >
              Export CSV
            </button>
          </div>
          {payments.length ? (
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Quando</th>
                  <th>Confirmacao</th>
                  <th>Valor</th>
                  <th>Code ID</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.payment_id}>
                    <td className="mono">{p.status}</td>
                    <td className="mono">{p.payment_id}</td>
                    <td className="mono">{formatDateTime(p.created_at)}</td>
                    <td className="mono">{p.confirmed_via ?? "-"}</td>
                    <td className="mono">{(p.amount_cents / 100).toFixed(2)} {p.currency}</td>
                    <td className="mono">{p.access_code_id ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="mono">{canQuery ? "Sem dados (ainda)." : "Faz login e atualiza."}</div>
          )}
        </section>
      ) : null}

      {tab === "events" ? (
        <section className="card">
          <h2>Eventos</h2>
          <p className="muted">Feed com filtros (incidentes/auditoria).</p>
          <div className="row">
            <input
              value={eventEntityType}
              onChange={(e) => setEventEntityType(e.target.value)}
              placeholder="entity_type (ex: access_code)"
              autoComplete="off"
            />
            <input
              value={eventEntityId}
              onChange={(e) => setEventEntityId(e.target.value)}
              placeholder="entity_id (UUID)"
              autoComplete="off"
            />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              value={eventTypeQuery}
              onChange={(e) => setEventTypeQuery(e.target.value)}
              placeholder="event_type contains"
              autoComplete="off"
            />
            <input
              value={eventSince}
              onChange={(e) => setEventSince(e.target.value)}
              placeholder="since (ISO, opcional)"
              autoComplete="off"
            />
            <input
              value={eventUntil}
              onChange={(e) => setEventUntil(e.target.value)}
              placeholder="until (ISO, opcional)"
              autoComplete="off"
            />
            <button onClick={loadEvents} disabled={!canQuery || busy !== null}>
              Aplicar filtros
            </button>
            <button
              onClick={() =>
                exportCsv("admin_export_events", "events.csv", {
                  entity_type: eventEntityType.trim() || undefined,
                  entity_id: eventEntityId.trim() || undefined,
                  event_type: eventTypeQuery.trim() || undefined,
                  since: eventSince.trim() || undefined,
                  until: eventUntil.trim() || undefined,
                })
              }
              disabled={!canQuery || busy !== null}
            >
              Export CSV
            </button>
          </div>
          {events.length ? (
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Evento</th>
                  <th>Entidade</th>
                  <th>Actor</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {events.map((a) => (
                  <tr key={a.event_id}>
                    <td className="mono">{formatDateTime(a.created_at)}</td>
                    <td className="mono">{a.event_type}</td>
                    <td className="mono">
                      {a.entity_type}:{a.entity_id ?? "-"}
                    </td>
                    <td className="mono">{a.actor_type}</td>
                    <td className="mono">{a.ip ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="mono">{canQuery ? "Sem dados (ainda)." : "Faz login e aplica filtros."}</div>
          )}
        </section>
      ) : null}
    </div>
  );
}
