import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import {
  clearAccessCode,
  clearPurchase,
  loadAccessCode,
  loadPurchase,
  saveAccessCode,
  savePurchase,
} from "./storage";
import type { CheckAccessStatusResponse, CreatePurchaseResponse, DemoPayResponse } from "./types";

function formatDateTime(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-PT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function formatRemaining(ms: number) {
  if (ms <= 0) return "Expirado";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

type Page = "landing" | "product" | "payment" | "code" | "status";

function readPageFromHash(): Page | null {
  const hash = window.location.hash.replace("#", "").trim();
  if (hash === "/status") return "status";
  return null;
}

function go(page: Page) {
  if (page === "status") window.location.hash = "#/status";
  else window.location.hash = "#/";
}

export function App() {
  const existingPurchase = useMemo(() => loadPurchase(), []);
  const existingCode = useMemo(() => loadAccessCode(), []);

  const [purchaseId, setPurchaseId] = useState<string | null>(existingPurchase.purchaseId);
  const [purchaseToken, setPurchaseToken] = useState<string | null>(existingPurchase.purchaseToken);

  const [accessCode, setAccessCode] = useState<string>(existingCode.code ?? "");
  const [validUntil, setValidUntil] = useState<string | null>(existingCode.validUntil);

  const [statusInput, setStatusInput] = useState<string>(existingCode.code ?? "");
  const [codeState, setCodeState] = useState<string | null>(existingCode.code ? "issued" : null);
  const [amountLabel, setAmountLabel] = useState<string>("—");
  const [page, setPage] = useState<Page>(() => {
    const fromHash = readPageFromHash();
    if (fromHash) return fromHash;
    if (existingCode.code) return "code";
    if (existingPurchase.purchaseToken) return "payment";
    return "landing";
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const onHash = () => {
      const fromHash = readPageFromHash();
      if (fromHash) setPage(fromHash);
      else setPage((prev) => (prev === "status" ? "landing" : prev));
    };
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  async function onCreatePurchase() {
    setBusy("start_purchase");
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke<CreatePurchaseResponse>(
        "start_purchase",
        { body: { product_code: "day_pass" } },
      );
      if (error) throw error;
      if (!data?.purchase) throw new Error("Resposta invalida do servidor");

      savePurchase(data.purchase.purchase_id, data.purchase.purchase_token);
      setPurchaseId(data.purchase.purchase_id);
      setPurchaseToken(data.purchase.purchase_token);
      setAmountLabel(`${(data.purchase.amount_cents / 100).toFixed(2)} ${data.purchase.currency}`);
      setMessage("Compra iniciada. Continua para o pagamento (mock).");
      setPage("payment");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setBusy(null);
    }
  }

  async function onDemoPay() {
    if (!purchaseToken) return;
    setBusy("confirm_purchase");
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke<DemoPayResponse>("confirm_purchase", {
        body: { purchase_token: purchaseToken },
      });
      if (error) throw error;
      if (!data?.result?.access_code) throw new Error("Resposta invalida do servidor");

      setAccessCode(data.result.access_code);
      setStatusInput(data.result.access_code);
      setValidUntil(data.result.valid_until);
      setCodeState("issued");
      saveAccessCode(data.result.access_code, data.result.valid_until);
      setMessage("Pagamento (demo) confirmado. Codigo emitido.");
      setPage("code");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setBusy(null);
    }
  }

  async function onCheckStatus() {
    setBusy("check_access_status");
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke<CheckAccessStatusResponse>(
        "check_access_status",
        { body: { code: statusInput } },
      );
      if (error) throw error;
      if (!data?.status) throw new Error("Resposta invalida do servidor");

      setCodeState(data.status.state);
      if (data.status.can_access) setMessage("Estado: issued (pode aceder).");
      else setMessage(`Estado: ${data.status.state}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setBusy(null);
    }
  }

  function onReset() {
    clearPurchase();
    clearAccessCode();
    setPurchaseId(null);
    setPurchaseToken(null);
    setAccessCode("");
    setValidUntil(null);
    setStatusInput("");
    setCodeState(null);
    setAmountLabel("—");
    setPage("landing");
    go("landing");
    setMessage("Estado local limpo.");
  }

  const remainingMs =
    validUntil && !Number.isNaN(new Date(validUntil).getTime())
      ? new Date(validUntil).getTime() - nowMs
      : null;

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1>BT Acesso</h1>
          <p className="muted">Acesso de 1 dia. Sem login. Fluxo simples.</p>
        </div>
        <button className="secondary" onClick={onReset} disabled={busy !== null}>
          Limpar
        </button>
      </header>

      {page === "landing" ? (
        <section className="card">
          <h2>1) Landing</h2>
          <p className="muted">
            Compra um acesso valido por 24 horas. Depois do pagamento (mock), recebes um codigo numerico de 6
            digitos.
          </p>
          <div className="row">
            <button onClick={() => setPage("product")} disabled={busy !== null} className="primary">
              Comprar acesso 1 dia
            </button>
            <button
              onClick={() => {
                setPage("status");
                go("status");
              }}
              disabled={busy !== null}
            >
              Verificar estado do codigo
            </button>
          </div>
        </section>
      ) : null}

      {page === "product" ? (
        <section className="card">
          <h2>2) Produto</h2>
          <p className="muted">Opcao unica neste MVP.</p>
          <div className="grid">
            <div>
              <div className="label">Produto</div>
              <div className="mono">Acesso 1 dia</div>
            </div>
            <div>
              <div className="label">Preco</div>
              <div className="mono">{amountLabel}</div>
            </div>
            <div>
              <div className="label">Validade</div>
              <div className="mono">24h</div>
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={() => setPage("landing")} disabled={busy !== null} className="secondary">
              Voltar
            </button>
            <button onClick={onCreatePurchase} disabled={busy !== null} className="primary">
              Continuar para pagamento
            </button>
          </div>
        </section>
      ) : null}

      {page === "payment" ? (
        <section className="card">
          <h2>3) Pagamento (mock)</h2>
          <p className="muted">
            Este passo e simulado. A emissao do codigo acontece apenas depois de confirmacao bem sucedida.
          </p>
          <div className="grid">
            <div>
              <div className="label">Purchase ID</div>
              <div className="mono">{purchaseId ?? "-"}</div>
            </div>
            <div>
              <div className="label">Token</div>
              <div className="mono">{purchaseToken ? `...${purchaseToken.slice(-6)}` : "-"}</div>
            </div>
            <div>
              <div className="label">Valor</div>
              <div className="mono">{amountLabel}</div>
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={() => setPage("product")} disabled={busy !== null} className="secondary">
              Voltar
            </button>
            <button onClick={onDemoPay} disabled={busy !== null || !purchaseToken} className="primary">
              Confirmar pagamento (mock) e gerar codigo
            </button>
          </div>
        </section>
      ) : null}

      {page === "code" ? (
        <section className="card">
          <h2>4) Codigo</h2>
          <p className="muted">O codigo so aparece depois de pagamento confirmado.</p>
          <div className="grid">
            <div>
              <div className="label">Codigo</div>
              <div className="code">{accessCode || "-"}</div>
            </div>
            <div>
              <div className="label">Expira em</div>
              <div className="mono">{formatDateTime(validUntil)}</div>
            </div>
            <div>
              <div className="label">Tempo restante</div>
              <div className="mono">{remainingMs === null ? "-" : formatRemaining(remainingMs)}</div>
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button
              onClick={() => {
                setPage("status");
                go("status");
              }}
              disabled={busy !== null}
            >
              Verificar estado
            </button>
            <button onClick={() => setPage("landing")} disabled={busy !== null} className="secondary">
              Voltar ao inicio
            </button>
          </div>
        </section>
      ) : null}

      {page === "status" ? (
        <section className="card">
          <h2>5) Status check</h2>
          <p className="muted">Consulta o estado do codigo na cloud. Nunca muta estado.</p>
          <div className="row">
            <input
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value)}
              inputMode="numeric"
              placeholder="000000"
              maxLength={6}
            />
            <button onClick={onCheckStatus} disabled={busy !== null}>
              Consultar
            </button>
            <button
              onClick={() => {
                setPage(accessCode ? "code" : "landing");
                go("landing");
              }}
              disabled={busy !== null}
              className="secondary"
            >
              Fechar
            </button>
          </div>
          <div className="mono">State: {codeState ?? "-"}</div>
        </section>
      ) : null}

      {message ? (
        <section className="card">
          <div className="mono">{message}</div>
        </section>
      ) : null}
    </div>
  );
}
