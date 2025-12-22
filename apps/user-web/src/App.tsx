import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { CheckAccessStatusResponse, CreatePurchaseResponse, DemoPayResponse, PaymentStatusResponse } from "./types";
import { BlockingLoading, Button, EmptyState, ErrorState, InputCode6, StatusBadge, useToast } from "@bt/shared/ui";
import { PwaNotifications } from "./PwaNotifications";

function formatDateTime(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-PT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

type Page = "b1" | "b2" | "b3_confirm" | "b3_code" | "b3_stripe" | "ds";

type HashRoute = { page: Page | null; params: URLSearchParams };

function parseHashRoute(): HashRoute {
  const raw = window.location.hash.replace("#", "").trim();
  if (raw === "" || raw === "/" || raw === "/b1") return { page: "b1", params: new URLSearchParams() };
  const [path, query = ""] = raw.split("?");
  const params = new URLSearchParams(query);
  if (path === "/b2") return { page: "b2", params };
  if (path === "/b3/confirm") return { page: "b3_confirm", params };
  if (path === "/b3/code") return { page: "b3_code", params };
  if (path === "/b3/stripe") return { page: "b3_stripe", params };
  if (path === "/ds") return { page: "ds", params };
  return { page: null, params };
}

function go(page: Page) {
  if (page === "b1") window.location.hash = "#/b1";
  else if (page === "b2") window.location.hash = "#/b2";
  else if (page === "b3_confirm") window.location.hash = "#/b3/confirm";
  else if (page === "b3_code") window.location.hash = "#/b3/code";
  else if (page === "b3_stripe") window.location.hash = "#/b3/stripe";
  else window.location.hash = "#/ds";
}

function normalizeErrorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  return "Erro desconhecido";
}

type Decision = {
  codeLast3: string;
  state: "VALID" | "EXPIRED" | "REVOKED" | "NOT_FOUND";
  serverTime: string;
  message: string;
};

type Purchase = {
  id: string;
  token: string;
  amountCents: number;
  currency: string;
  validityHours: number;
  checkoutUrl: string | null;
  provider: string | null;
};

type IssuedCode = {
  code: string;
  validUntil: string;
  purchaseId: string;
};

type SavedCode = {
  code: string;
  validUntil: string;
  purchaseId: string;
};

type PaymentStatus = {
  status: string;
  purchaseId: string;
  accessCode: string | null;
  validUntil: string | null;
};

type PendingPurchase = {
  token: string;
  productCode: string;
  createdAt: string;
};

const PENDING_PURCHASE_KEY = "bt_pending_purchase";
const SAVED_CODES_KEY = "bt_saved_codes";
const PURCHASE_HISTORY_KEY = "bt_purchase_history";

function readPendingPurchase(): PendingPurchase | null {
  try {
    const raw = localStorage.getItem(PENDING_PURCHASE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingPurchase;
  } catch {
    return null;
  }
}

function writePendingPurchase(pending: PendingPurchase | null) {
  if (!pending) {
    localStorage.removeItem(PENDING_PURCHASE_KEY);
    return;
  }
  localStorage.setItem(PENDING_PURCHASE_KEY, JSON.stringify(pending));
}

function readSavedCodes(): SavedCode[] {
  try {
    const raw = localStorage.getItem(SAVED_CODES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item &&
        typeof item.code === "string" &&
        typeof item.validUntil === "string" &&
        typeof item.purchaseId === "string",
    ) as SavedCode[];
  } catch {
    return [];
  }
}

function writeSavedCodes(codes: SavedCode[]) {
  try {
    localStorage.setItem(SAVED_CODES_KEY, JSON.stringify(codes));
  } catch {
    // Ignore write errors (storage full or unavailable).
  }
}

function upsertSavedCode(existing: SavedCode[], next: SavedCode): SavedCode[] {
  const filtered = existing.filter((item) => item.purchaseId !== next.purchaseId && item.code !== next.code);
  return [next, ...filtered].slice(0, 10);
}

type PurchaseHistoryItem = {
  purchaseId: string;
  status: string;
  amountCents: number | null;
  currency: string | null;
  provider: string | null;
  createdAt: string;
  updatedAt: string;
  accessCodeLast3: string | null;
  validUntil: string | null;
};

function readPurchaseHistory(): PurchaseHistoryItem[] {
  try {
    const raw = localStorage.getItem(PURCHASE_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item &&
        typeof item.purchaseId === "string" &&
        typeof item.status === "string" &&
        typeof item.createdAt === "string" &&
        typeof item.updatedAt === "string",
    ) as PurchaseHistoryItem[];
  } catch {
    return [];
  }
}

function writePurchaseHistory(items: PurchaseHistoryItem[]) {
  try {
    localStorage.setItem(PURCHASE_HISTORY_KEY, JSON.stringify(items));
  } catch {
    // Ignore write errors (storage full or unavailable).
  }
}

function upsertPurchaseHistory(existing: PurchaseHistoryItem[], next: PurchaseHistoryItem): PurchaseHistoryItem[] {
  const idx = existing.findIndex((item) => item.purchaseId === next.purchaseId);
  if (idx === -1) return [next, ...existing].slice(0, 10);
  const current = existing[idx];
  const merged: PurchaseHistoryItem = {
    ...current,
    ...next,
    createdAt: current.createdAt,
  };
  const copy = [...existing];
  copy[idx] = merged;
  return copy;
}

function makeClientToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function App() {
  const { push } = useToast();
  const [code, setCode] = useState<string>("");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [revealDecisionCode, setRevealDecisionCode] = useState<boolean>(false);
  const [revealIssuedCode, setRevealIssuedCode] = useState<boolean>(false);

  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [stripeSessionId, setStripeSessionId] = useState<string | null>(null);
  const [stripeStatus, setStripeStatus] = useState<PaymentStatus | null>(null);
  const [stripePolling, setStripePolling] = useState<boolean>(false);
  const [savedCodes, setSavedCodes] = useState<SavedCode[]>(() => readSavedCodes());
  const [purchaseHistory, setPurchaseHistory] = useState<PurchaseHistoryItem[]>(() => readPurchaseHistory());

  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>(() => parseHashRoute().page ?? "b1");
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingPurchase, setPendingPurchase] = useState<PendingPurchase | null>(() => readPendingPurchase());
  const [retryAction, setRetryAction] = useState<"validate" | "start_purchase" | "confirm_purchase" | "payment_status" | null>(
    null,
  );

  function requireOnline(action: typeof retryAction, message: string) {
    if (navigator.onLine) return true;
    setError(message);
    setRetryAction(action);
    return false;
  }

  function rememberCode(next: SavedCode) {
    setSavedCodes((prev) => {
      const updated = upsertSavedCode(prev, next);
      writeSavedCodes(updated);
      return updated;
    });
  }

  function rememberPurchase(next: PurchaseHistoryItem) {
    setPurchaseHistory((prev) => {
      const updated = upsertPurchaseHistory(prev, next);
      writePurchaseHistory(updated);
      return updated;
    });
  }

  function rememberIssued(next: IssuedCode) {
    setIssued(next);
    rememberCode(next);
  }

  async function startPurchase(clientToken: string, source: "manual" | "resume") {
    setBusy("start_purchase");
    setError(null);
    setRetryAction(null);
    setPurchase(null);
    setIssued(null);
    setStripeStatus(null);
    try {
      const { data, error } = await supabase.functions.invoke<CreatePurchaseResponse>("start_purchase", {
        body: { product_code: "day_pass", client_token: clientToken },
      });
      if (error) throw error;
      if (!data?.purchase) throw new Error("Resposta invÇ­lida do servidor");

      writePendingPurchase(null);
      setPendingPurchase(null);

      setPurchase({
        id: data.purchase.purchase_id,
        token: data.purchase.purchase_token,
        amountCents: data.purchase.amount_cents,
        currency: data.purchase.currency,
        validityHours: data.purchase.validity_hours,
        checkoutUrl: data.purchase.checkout_url ?? null,
        provider: data.purchase.provider ?? null,
      });
      const now = new Date().toISOString();
      rememberPurchase({
        purchaseId: data.purchase.purchase_id,
        status: "created",
        amountCents: data.purchase.amount_cents,
        currency: data.purchase.currency,
        provider: data.purchase.provider ?? null,
        createdAt: now,
        updatedAt: now,
        accessCodeLast3: null,
        validUntil: null,
      });
      setPage("b3_confirm");
      go("b3_confirm");
    } catch (e) {
      setError(normalizeErrorMessage(e));
      if (!navigator.onLine && source === "manual") {
        const pending = { token: clientToken, productCode: "day_pass", createdAt: new Date().toISOString() };
        writePendingPurchase(pending);
        setPendingPurchase(pending);
      } else {
        setRetryAction("start_purchase");
      }
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    const onHash = () => {
      const { page: fromHash, params } = parseHashRoute();
      if (fromHash) setPage(fromHash);
      else setPage("b1");

      if (fromHash === "b3_stripe") {
        setStripeSessionId(params.get("session_id"));
      } else {
        setStripeSessionId(null);
        setStripeStatus(null);
      }
    };
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  async function onValidate() {
    if (!requireOnline("validate", "Requer ligacao a internet para validar o codigo.")) return;
    setBusy("check_access_status");
    setError(null);
    setRetryAction(null);
    try {
      const { data, error } = await supabase.functions.invoke<CheckAccessStatusResponse>("check_access_status", {
        body: { code },
      });
      if (error) throw error;
      if (!data?.status || !data?.server_time) throw new Error("Resposta inválida do servidor");

      const status = data.status;
      const mappedState =
        status.state === "expired"
          ? ("EXPIRED" as const)
          : status.state === "revoked"
            ? ("REVOKED" as const)
            : status.state === "issued" && status.can_access
              ? ("VALID" as const)
              : ("NOT_FOUND" as const);

      if (status.valid_until && /^[0-9]{6}$/.test(code) && mappedState !== "NOT_FOUND") {
        rememberCode({
          code,
          validUntil: status.valid_until,
          purchaseId: `manual:${code}`,
        });
      }

      setDecision({
        codeLast3: code.slice(-3),
        state: mappedState,
        serverTime: data.server_time,
        message: mappedState === "VALID" ? "Acesso permitido." : "Acesso negado.",
      });
      setPage("b2");
      go("b2");
    } catch (e) {
      setError(normalizeErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  function onBackToValidate() {
    setDecision(null);
    setRevealDecisionCode(false);
    setCode("");
    setError(null);
    setPage("b1");
    go("b1");
  }

  async function onBuyStart() {
    setRetryAction(null);
    if (!navigator.onLine) {
      if (pendingPurchase) {
        setError("Compra pendente. Assim que tiveres ligacao, continuamos.");
      } else {
        const pending = { token: makeClientToken(), productCode: "day_pass", createdAt: new Date().toISOString() };
        writePendingPurchase(pending);
        setPendingPurchase(pending);
        setError("Sem ligacao. A compra foi colocada em fila.");
        push({ title: "Compra pendente", message: "Vamos tentar assim que estiveres online." });
      }
      return;
    }
    if (pendingPurchase) {
      await startPurchase(pendingPurchase.token, "resume");
      return;
    }
    await startPurchase(makeClientToken(), "manual");
  }

  async function onBuyConfirm() {
    if (!purchase) return;
    if (purchase.checkoutUrl) {
      if (!requireOnline("confirm_purchase", "Requer ligacao a internet para continuar o pagamento.")) return;
      window.location.href = purchase.checkoutUrl;
      return;
    }
    if (!requireOnline("confirm_purchase", "Requer ligacao a internet para confirmar a compra.")) return;
    setBusy("confirm_purchase");
    setError(null);
    setRetryAction(null);
    try {
      const { data, error } = await supabase.functions.invoke<DemoPayResponse>("confirm_purchase", {
        body: { purchase_token: purchase.token },
      });
      if (error) throw error;
      if (!data?.result?.access_code || !data.result.valid_until || !data.result.purchase_id) {
        throw new Error("Resposta inválida do servidor");
      }

      rememberIssued({
        code: data.result.access_code,
        validUntil: data.result.valid_until,
        purchaseId: data.result.purchase_id,
      });
      const now = new Date().toISOString();
      rememberPurchase({
        purchaseId: data.result.purchase_id,
        status: "paid",
        amountCents: purchase?.amountCents ?? null,
        currency: purchase?.currency ?? null,
        provider: purchase?.provider ?? "mock",
        createdAt: now,
        updatedAt: now,
        accessCodeLast3: data.result.access_code.slice(-3),
        validUntil: data.result.valid_until,
      });
      setPage("b3_code");
      go("b3_code");
    } catch (e) {
      setError(normalizeErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  function onBuyClose() {
    setPurchase(null);
    setIssued(null);
    setStripeStatus(null);
    setError(null);
    setRevealDecisionCode(false);
    setRevealIssuedCode(false);
    setPage("b1");
    go("b1");
  }

  async function fetchStripeStatus(manual = false): Promise<PaymentStatus | null> {
    if (!navigator.onLine) {
      if (manual) {
        setError("Requer ligacao a internet para atualizar o estado do pagamento.");
        setRetryAction("payment_status");
      }
      return null;
    }
    if (!stripeSessionId) return null;
    if (manual) setBusy("payment_status");
    setError(null);
    if (manual) setRetryAction(null);
    try {
      const { data, error } = await supabase.functions.invoke<PaymentStatusResponse>("payment_status", {
        body: { provider_payment_id: stripeSessionId },
      });
      if (error) throw error;
      if (!data?.payment) throw new Error("Resposta invǭlida do servidor");

      const status: PaymentStatus = {
        status: data.payment.status,
        purchaseId: data.payment.purchase_id,
        accessCode: data.payment.access_code,
        validUntil: data.payment.valid_until,
      };
      setStripeStatus(status);
      const now = new Date().toISOString();
      rememberPurchase({
        purchaseId: status.purchaseId,
        status: status.status,
        amountCents: purchase?.amountCents ?? null,
        currency: purchase?.currency ?? null,
        provider: "stripe",
        createdAt: now,
        updatedAt: now,
        accessCodeLast3: status.accessCode ? status.accessCode.slice(-3) : null,
        validUntil: status.validUntil ?? null,
      });

      if (status.status === "paid" && status.accessCode) {
        rememberIssued({
          code: status.accessCode,
          validUntil: status.validUntil ?? "",
          purchaseId: status.purchaseId,
        });
        setPage("b3_code");
        go("b3_code");
      }
      return status;
    } catch (e) {
      setError(normalizeErrorMessage(e));
      return null;
    } finally {
      if (manual) setBusy(null);
    }
  }

  useEffect(() => {
    if (page !== "b3_stripe" || !stripeSessionId) return;
    let active = true;
    let timeoutId: number | null = null;

    const poll = async () => {
      if (!active) return;
      setStripePolling(true);
      const nextStatus = await fetchStripeStatus(false);
      setStripePolling(false);
      if (active && nextStatus?.status === "pending") {
        timeoutId = window.setTimeout(poll, 3000);
      }
    };

    poll();
    return () => {
      active = false;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [page, stripeSessionId]);

  useEffect(() => {
    if (!pendingPurchase || busy) return;
    if (retryAction === "start_purchase") return;
    if (!navigator.onLine) return;
    startPurchase(pendingPurchase.token, "resume");
  }, [pendingPurchase, busy, retryAction]);

  useEffect(() => {
    const onOnline = () => {
      if (pendingPurchase && !busy && retryAction !== "start_purchase") {
        startPurchase(pendingPurchase.token, "resume");
      }
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [pendingPurchase, busy, retryAction]);

  const maskedIssued = issued ? `***${issued.code.slice(-3)}` : null;
  const fullIssued = issued?.code ?? null;
  const maskedDecision = code ? `***${code.slice(-3)}` : "***";
  const savedList = savedCodes;
  const savedCodesView = savedList.length ? (
    <section className="bt-card" style={{ marginTop: 12 }}>
      <h2 className="bt-h2">Meus codigos</h2>
      {savedList.map((item) => {
        const status = item.validUntil && new Date(item.validUntil).getTime() > Date.now() ? "ACTIVE" : "EXPIRED";
        return (
          <div
            key={`${item.purchaseId}-${item.code}`}
            className="bt-row"
            style={{ justifyContent: "space-between", alignItems: "center", marginTop: 10 }}
          >
            <div className="bt-mono">Codigo: {item.code}</div>
            <div className="bt-mono">Valido ate: {formatDateTime(item.validUntil)}</div>
            <StatusBadge tone={status === "ACTIVE" ? "success" : "danger"} text={status} />
          </div>
        );
      })}
    </section>
  ) : null;
  const purchaseHistoryView = purchaseHistory.length ? (
    <section className="bt-card" style={{ marginTop: 12 }}>
      <h2 className="bt-h2">Historico de compras</h2>
      {purchaseHistory.map((item) => {
        const status = item.status.toUpperCase();
        const tone =
          status === "PAID"
            ? "success"
            : status === "FAILED" || status === "EXPIRED" || status === "REFUNDED" || status === "CANCELED"
              ? "danger"
              : "neutral";
        const price =
          item.amountCents !== null && item.currency
            ? `${(item.amountCents / 100).toFixed(2)} ${item.currency}`
            : "-";
        return (
          <div
            key={item.purchaseId}
            className="bt-row"
            style={{ justifyContent: "space-between", alignItems: "center", marginTop: 10 }}
          >
            <div className="bt-mono">ID: {item.purchaseId.slice(-6)}</div>
            <div className="bt-mono">Total: {price}</div>
            <div className="bt-mono">Atualizado: {formatDateTime(item.updatedAt)}</div>
            <StatusBadge tone={tone} text={status} />
          </div>
        );
      })}
    </section>
  ) : null;

  return (
    <div className="bt-container">
      {busy ? <BlockingLoading label={busy} /> : null}
      <header className="bt-header">
        <div>
          <h1 className="bt-h1">Validar acesso</h1>
        </div>
        <PwaNotifications />
      </header>

      {error ? (
        <div>
          <ErrorState message={error} />
          {retryAction ? (
            <div className="bt-row" style={{ marginTop: 12 }}>
              <Button
                variant="ghost"
                onClick={() => {
                  if (retryAction === "validate") onValidate();
                  else if (retryAction === "start_purchase") {
                    if (pendingPurchase) startPurchase(pendingPurchase.token, "resume");
                    else onBuyStart();
                  }
                  else if (retryAction === "confirm_purchase") onBuyConfirm();
                  else if (retryAction === "payment_status") fetchStripeStatus(true);
                }}
                disabled={busy !== null}
              >
                Tentar novamente
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {page === "b1" ? (
        <>
          <section className="bt-card">
            {pendingPurchase ? (
              <div className="bt-row" style={{ marginBottom: 10 }}>
                <StatusBadge tone="neutral" text="COMPRA PENDENTE" />
                <div className="bt-mono">Sera retomada quando a ligacao voltar.</div>
              </div>
            ) : null}
            <div className="bt-row">
              <InputCode6 value={code} onChange={setCode} aria-label="Codigo de acesso" />
              <Button variant="primary" onClick={onValidate} disabled={busy !== null}>
                Validar
              </Button>
            </div>

            <div className="bt-row" style={{ marginTop: 12 }}>
              <Button variant="ghost" onClick={onBuyStart} disabled={busy !== null}>
                Comprar acesso 1 dia
              </Button>
            </div>
          </section>
          {purchaseHistoryView}
          {savedCodesView}
        </>
      ) : null}

      {page === "b2" ? (
        <section className="bt-card">
          <h2 className="bt-h2">Resultado</h2>
          {decision ? (
            <>
              <div className="bt-row" style={{ justifyContent: "space-between" }}>
                <div className="bt-mono">Código: {revealDecisionCode ? code : maskedDecision}</div>
                <StatusBadge tone={decision.state === "VALID" ? "success" : "danger"} text={decision.state} />
              </div>
              <div className="bt-row" style={{ marginTop: 10 }}>
                <Button
                  variant="ghost"
                  onClick={() => setRevealDecisionCode((v) => !v)}
                  disabled={busy !== null || !code}
                >
                  {revealDecisionCode ? "Mascarar" : "Desmascarar"}
                </Button>
              </div>
              <div className="bt-mono" style={{ marginTop: 10 }}>
                {decision.message}
              </div>
              <div className="bt-row" style={{ marginTop: 12 }}>
                <Button variant="ghost" onClick={onBackToValidate} disabled={busy !== null}>
                  Voltar
                </Button>
              </div>
            </>
          ) : (
            <>
              <EmptyState message="Sem decisão. Volta ao ecrã de validação e submete manualmente." />
              <div className="bt-row" style={{ marginTop: 12 }}>
                <Button variant="ghost" onClick={onBackToValidate} disabled={busy !== null}>
                  Voltar
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {page === "b3_confirm" ? (
        <section className="bt-card">
          <h2 className="bt-h2">{purchase?.checkoutUrl ? "Continuar pagamento (Stripe)" : "Confirmar compra (mock)"}</h2>
          {purchase ? (
            <>
              <div className="bt-grid">
                <div>
                  <div className="bt-label">Produto</div>
                  <div className="bt-mono">Acesso 1 dia</div>
                </div>
                <div>
                  <div className="bt-label">Preço</div>
                  <div className="bt-mono">
                    {(purchase.amountCents / 100).toFixed(2)} {purchase.currency}
                  </div>
                </div>
                <div>
                  <div className="bt-label">Validade</div>
                  <div className="bt-mono">{purchase.validityHours}h</div>
                </div>
              </div>
              <div className="bt-row" style={{ marginTop: 12 }}>
                <Button variant="primary" onClick={onBuyConfirm} disabled={busy !== null}>
                  {purchase.checkoutUrl ? "Ir para pagamento" : "Confirmar"}
                </Button>
                <Button variant="ghost" onClick={onBuyClose} disabled={busy !== null}>
                  Voltar
                </Button>
              </div>
            </>
          ) : (
            <>
              <EmptyState message="Sem compra iniciada. Volta e clica em “Comprar acesso 1 dia”." />
              <div className="bt-row" style={{ marginTop: 12 }}>
                <Button variant="ghost" onClick={onBuyClose} disabled={busy !== null}>
                  Voltar
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {page === "b3_stripe" ? (
        <section className="bt-card">
          <h2 className="bt-h2">Estado do pagamento</h2>
          {stripeSessionId ? (
            <>
              <div className="bt-row" style={{ marginTop: 10 }}>
                <StatusBadge
                  tone={
                    stripeStatus?.status === "paid"
                      ? "success"
                      : stripeStatus?.status === "failed" || stripeStatus?.status === "expired" || stripeStatus?.status === "refunded"
                        ? "danger"
                        : "neutral"
                  }
                  text={stripeStatus?.status ?? "pending"}
                />
              </div>
              <div className="bt-mono" style={{ marginTop: 10 }}>
                {stripePolling ? "A atualizar..." : null}
              </div>
              <div className="bt-row" style={{ marginTop: 12 }}>
                <Button variant="ghost" onClick={() => fetchStripeStatus(true)} disabled={busy !== null}>
                  Atualizar
                </Button>
                <Button variant="ghost" onClick={onBuyClose} disabled={busy !== null}>
                  Voltar
                </Button>
              </div>
            </>
          ) : (
            <>
              <EmptyState message="Sessao em falta. Volta ao inicio e inicia a compra." />
              <div className="bt-row" style={{ marginTop: 12 }}>
                <Button variant="ghost" onClick={onBuyClose} disabled={busy !== null}>
                  Voltar
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {page === "b3_code" ? (
        <section className="bt-card">
          <h2 className="bt-h2">Código emitido</h2>
          {issued ? (
            <>
              <div className="bt-row" style={{ justifyContent: "space-between" }}>
                <div className="bt-mono">Código: {revealIssuedCode ? fullIssued : maskedIssued}</div>
                <StatusBadge tone="success" text="ISSUED" />
              </div>
              <div className="bt-row" style={{ marginTop: 10 }}>
                <Button
                  variant="ghost"
                  onClick={() => setRevealIssuedCode((v) => !v)}
                  disabled={busy !== null || !issued}
                >
                  {revealIssuedCode ? "Mascarar" : "Desmascarar"}
                </Button>
              </div>
              <div className="bt-mono" style={{ marginTop: 10 }}>
                Válido até: {formatDateTime(issued.validUntil)}
              </div>
              <div className="bt-mono" style={{ marginTop: 10 }}>
                Aviso: este codigo fica guardado neste dispositivo.
              </div>
              <div className="bt-row" style={{ marginTop: 12 }}>
                <Button variant="ghost" onClick={onBuyClose} disabled={busy !== null}>
                  Voltar
                </Button>
              </div>
              {savedCodesView}
            </>
          ) : (
            <>
              <EmptyState message="Sem código. Faz a confirmação na cloud." />
              <div className="bt-row" style={{ marginTop: 12 }}>
                <Button variant="ghost" onClick={onBuyClose} disabled={busy !== null}>
                  Voltar
                </Button>
              </div>
              
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
