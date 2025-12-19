import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { CheckAccessStatusResponse, CreatePurchaseResponse, DemoPayResponse, PaymentStatusResponse } from "./types";
import { BlockingLoading, Button, EmptyState, ErrorState, InputCode6, StatusBadge } from "@bt/shared/ui";

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

type PaymentStatus = {
  status: string;
  purchaseId: string;
  accessCode: string | null;
  validUntil: string | null;
};

export function App() {
  const [code, setCode] = useState<string>("");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [revealDecisionCode, setRevealDecisionCode] = useState<boolean>(false);
  const [revealIssuedCode, setRevealIssuedCode] = useState<boolean>(false);

  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [stripeSessionId, setStripeSessionId] = useState<string | null>(null);
  const [stripeStatus, setStripeStatus] = useState<PaymentStatus | null>(null);
  const [stripePolling, setStripePolling] = useState<boolean>(false);

  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>(() => parseHashRoute().page ?? "b1");
  const [busy, setBusy] = useState<string | null>(null);

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
    setBusy("check_access_status");
    setError(null);
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
    setBusy("start_purchase");
    setError(null);
    setPurchase(null);
    setIssued(null);
    setStripeStatus(null);
    try {
      const { data, error } = await supabase.functions.invoke<CreatePurchaseResponse>("start_purchase", {
        body: { product_code: "day_pass" },
      });
      if (error) throw error;
      if (!data?.purchase) throw new Error("Resposta inválida do servidor");

      setPurchase({
        id: data.purchase.purchase_id,
        token: data.purchase.purchase_token,
        amountCents: data.purchase.amount_cents,
        currency: data.purchase.currency,
        validityHours: data.purchase.validity_hours,
        checkoutUrl: data.purchase.checkout_url ?? null,
        provider: data.purchase.provider ?? null,
      });
      setPage("b3_confirm");
      go("b3_confirm");
    } catch (e) {
      setError(normalizeErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function onBuyConfirm() {
    if (!purchase) return;
    if (purchase.checkoutUrl) {
      window.location.href = purchase.checkoutUrl;
      return;
    }
    setBusy("confirm_purchase");
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke<DemoPayResponse>("confirm_purchase", {
        body: { purchase_token: purchase.token },
      });
      if (error) throw error;
      if (!data?.result?.access_code || !data.result.valid_until || !data.result.purchase_id) {
        throw new Error("Resposta inválida do servidor");
      }

      setIssued({ code: data.result.access_code, validUntil: data.result.valid_until, purchaseId: data.result.purchase_id });
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
    if (!stripeSessionId) return null;
    if (manual) setBusy("payment_status");
    setError(null);
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

      if (status.status === "paid" && status.accessCode) {
        setIssued({
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

  const maskedIssued = issued ? `***${issued.code.slice(-3)}` : null;
  const fullIssued = issued?.code ?? null;
  const maskedDecision = code ? `***${code.slice(-3)}` : "***";

  return (
    <div className="bt-container">
      {busy ? <BlockingLoading label={busy} /> : null}
      <header className="bt-header">
        <div>
          <h1 className="bt-h1">Validar acesso</h1>
        </div>
      </header>

      {error ? <ErrorState message={error} /> : null}

      {page === "b1" ? (
        <section className="bt-card">
          <div className="bt-row">
            <InputCode6 value={code} onChange={setCode} aria-label="Código de acesso" />
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
                Aviso: este código é apresentado uma única vez. Anota já.
              </div>
              <div className="bt-row" style={{ marginTop: 12 }}>
                <Button variant="ghost" onClick={onBuyClose} disabled={busy !== null}>
                  Voltar
                </Button>
              </div>
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
