import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import type { CheckAccessStatusResponse, CreatePurchaseResponse, DemoPayResponse, PaymentStatusResponse } from "./types";
import { BlockingLoading, Button, EmptyState, ErrorState, InputCode6, StatusBadge, useToast } from "@bt/shared/ui";
import { PwaNotifications } from "./PwaNotifications";

type Language = "pt" | "en" | "fr";

const LANGUAGE_KEY = "bt_language";
const LANGUAGE_LABELS: Record<Language, string> = {
  pt: "Português",
  en: "English",
  fr: "Français",
};
const LOCALE_BY_LANGUAGE: Record<Language, string> = {
  pt: "pt-PT",
  en: "en-GB",
  fr: "fr-FR",
};

type TranslationFn = (params: Record<string, string>) => string;

const TRANSLATIONS: Record<Language, Record<string, string | TranslationFn>> = {
  pt: {
    language_label: "Idioma",
    unknown_error: "Erro desconhecido.",
    invalid_server_response: "Resposta inválida do servidor.",
    require_online_validate: "Requer ligação à internet para validar o código.",
    require_online_continue_payment: "Requer ligação à internet para continuar o pagamento.",
    require_online_confirm_purchase: "Requer ligação à internet para confirmar a compra.",
    require_online_refresh_payment: "Requer ligação à internet para atualizar o estado do pagamento.",
    pending_purchase_resume: "Compra pendente. Assim que tiveres ligação, continuamos.",
    offline_queued: "Sem ligação. A compra foi colocada em fila.",
    pending_purchase_title: "Compra pendente",
    pending_purchase_toast: "Vamos tentar assim que estiveres online.",
    access_allowed: "Acesso permitido.",
    access_denied: "Acesso negado.",
    my_codes: "Meus códigos",
    empty_codes: "Ainda nao tens codigos guardados.",
    code_label: "Código",
    valid_until_label: "Válido até",
    purchase_history_title: "Histórico de compras",
    id_label: "ID",
    total_label: "Total",
    updated_label: "Atualizado",
    title_validate_access: "Validar acesso",
    retry: "Tentar novamente",
    pending_purchase_badge: "COMPRA PENDENTE",
    pending_purchase_note: "Será retomada quando a ligação voltar.",
    access_code_aria: "Código de acesso",
    validate: "Validar",
    buy_access_one_day: "Comprar acesso 1 dia",
    result_title: "Resultado",
    mask: "Mascarar",
    unmask: "Desmascarar",
    back: "Voltar",
    empty_decision: "Sem decisão. Volta ao ecrã de validação e submete manualmente.",
    confirm_stripe_title: "Continuar pagamento (Stripe)",
    confirm_mock_title: "Confirmar compra (mock)",
    product_label: "Produto",
    product_day_pass: "Acesso 1 dia",
    price_label: "Preço",
    validity_label: "Validade",
    go_to_payment: "Ir para pagamento",
    confirm: "Confirmar",
    empty_purchase: ({ cta }) => `Sem compra iniciada. Volta e clica em "${cta}".`,
    payment_status_title: "Estado do pagamento",
    updating: "A atualizar...",
    refresh: "Atualizar",
    empty_stripe_session: "Sessão em falta. Volta ao início e inicia a compra.",
    issued_code_title: "Código emitido",
    valid_until_text: ({ date }) => `Válido até: ${date}`,
    issued_notice: "Aviso: este código fica guardado neste dispositivo.",
    empty_code: "Sem código. Faz a confirmação na cloud.",
    busy_start_purchase: "A iniciar compra...",
    busy_check_access_status: "A validar...",
    busy_confirm_purchase: "A confirmar compra...",
    busy_payment_status: "A atualizar pagamento...",
    stripe_polling_stopped: "Pagamento ainda pendente. Atualiza manualmente daqui a pouco.",
    decision_valid: "VÁLIDO",
    decision_expired: "EXPIRADO",
    decision_revoked: "REVOGADO",
    decision_not_found: "NÃO ENCONTRADO",
    status_active: "ATIVO",
    status_expired: "EXPIRADO",
    status_paid: "PAGO",
    status_failed: "FALHOU",
    status_refunded: "REEMBOLSADO",
    status_canceled: "CANCELADO",
    status_pending: "PENDENTE",
    status_issued: "EMITIDO",
  },
  en: {
    language_label: "Language",
    unknown_error: "Unknown error.",
    invalid_server_response: "Invalid server response.",
    require_online_validate: "Internet connection required to validate the code.",
    require_online_continue_payment: "Internet connection required to continue the payment.",
    require_online_confirm_purchase: "Internet connection required to confirm the purchase.",
    require_online_refresh_payment: "Internet connection required to refresh payment status.",
    pending_purchase_resume: "Purchase pending. We'll resume once you're back online.",
    offline_queued: "Offline. The purchase was queued.",
    pending_purchase_title: "Pending purchase",
    pending_purchase_toast: "We'll retry as soon as you're online.",
    access_allowed: "Access granted.",
    access_denied: "Access denied.",
    my_codes: "My codes",
    empty_codes: "No saved codes yet.",
    code_label: "Code",
    valid_until_label: "Valid until",
    purchase_history_title: "Purchase history",
    id_label: "ID",
    total_label: "Total",
    updated_label: "Updated",
    title_validate_access: "Validate access",
    retry: "Try again",
    pending_purchase_badge: "PENDING PURCHASE",
    pending_purchase_note: "Will resume when connection is back.",
    access_code_aria: "Access code",
    validate: "Validate",
    buy_access_one_day: "Buy 1-day access",
    result_title: "Result",
    mask: "Mask",
    unmask: "Unmask",
    back: "Back",
    empty_decision: "No decision. Go back to the validation screen and submit manually.",
    confirm_stripe_title: "Continue payment (Stripe)",
    confirm_mock_title: "Confirm purchase (mock)",
    product_label: "Product",
    product_day_pass: "1-day access",
    price_label: "Price",
    validity_label: "Validity",
    go_to_payment: "Go to payment",
    confirm: "Confirm",
    empty_purchase: ({ cta }) => `No purchase started. Go back and click "${cta}".`,
    payment_status_title: "Payment status",
    updating: "Updating...",
    refresh: "Refresh",
    empty_stripe_session: "Missing session. Go back to the start and begin the purchase.",
    issued_code_title: "Issued code",
    valid_until_text: ({ date }) => `Valid until: ${date}`,
    issued_notice: "Note: this code is stored on this device.",
    empty_code: "No code. Confirm in the cloud.",
    busy_start_purchase: "Starting purchase...",
    busy_check_access_status: "Validating...",
    busy_confirm_purchase: "Confirming purchase...",
    busy_payment_status: "Refreshing payment...",
    stripe_polling_stopped: "Payment still pending. Refresh manually in a moment.",
    decision_valid: "VALID",
    decision_expired: "EXPIRED",
    decision_revoked: "REVOKED",
    decision_not_found: "NOT FOUND",
    status_active: "ACTIVE",
    status_expired: "EXPIRED",
    status_paid: "PAID",
    status_failed: "FAILED",
    status_refunded: "REFUNDED",
    status_canceled: "CANCELED",
    status_pending: "PENDING",
    status_issued: "ISSUED",
  },
  fr: {
    language_label: "Langue",
    unknown_error: "Erreur inconnue.",
    invalid_server_response: "Réponse du serveur invalide.",
    require_online_validate: "Connexion internet requise pour valider le code.",
    require_online_continue_payment: "Connexion internet requise pour continuer le paiement.",
    require_online_confirm_purchase: "Connexion internet requise pour confirmer l'achat.",
    require_online_refresh_payment: "Connexion internet requise pour actualiser l'état du paiement.",
    pending_purchase_resume: "Achat en attente. Nous reprendrons dès que vous serez en ligne.",
    offline_queued: "Hors ligne. L'achat a été mis en file d'attente.",
    pending_purchase_title: "Achat en attente",
    pending_purchase_toast: "Nous réessaierons dès que vous serez en ligne.",
    access_allowed: "Accès autorisé.",
    access_denied: "Accès refusé.",
    my_codes: "Mes codes",
    empty_codes: "Aucun code enregistre pour le moment.",
    code_label: "Code",
    valid_until_label: "Valable jusqu'au",
    purchase_history_title: "Historique des achats",
    id_label: "ID",
    total_label: "Total",
    updated_label: "Mis à jour",
    title_validate_access: "Valider l'accès",
    retry: "Réessayer",
    pending_purchase_badge: "ACHAT EN ATTENTE",
    pending_purchase_note: "Reprendra quand la connexion sera revenue.",
    access_code_aria: "Code d'accès",
    validate: "Valider",
    buy_access_one_day: "Acheter un accès 1 jour",
    result_title: "Résultat",
    mask: "Masquer",
    unmask: "Démasquer",
    back: "Retour",
    empty_decision: "Aucune décision. Revenez à l'écran de validation et soumettez manuellement.",
    confirm_stripe_title: "Continuer le paiement (Stripe)",
    confirm_mock_title: "Confirmer l'achat (mock)",
    product_label: "Produit",
    product_day_pass: "Accès 1 jour",
    price_label: "Prix",
    validity_label: "Validité",
    go_to_payment: "Aller au paiement",
    confirm: "Confirmer",
    empty_purchase: ({ cta }) => `Aucun achat démarré. Revenez en arrière et cliquez sur "${cta}".`,
    payment_status_title: "État du paiement",
    updating: "Mise à jour...",
    refresh: "Actualiser",
    empty_stripe_session: "Session manquante. Revenez au début et lancez l'achat.",
    issued_code_title: "Code émis",
    valid_until_text: ({ date }) => `Valable jusqu'au : ${date}`,
    issued_notice: "Note : ce code est enregistré sur cet appareil.",
    empty_code: "Aucun code. Confirmez dans le cloud.",
    busy_start_purchase: "Démarrage de l'achat...",
    busy_check_access_status: "Validation...",
    busy_confirm_purchase: "Confirmation de l'achat...",
    busy_payment_status: "Actualisation du paiement...",
    stripe_polling_stopped: "Paiement encore en attente. Actualisez manuellement dans un instant.",
    decision_valid: "VALIDE",
    decision_expired: "EXPIRÉ",
    decision_revoked: "RÉVOQUÉ",
    decision_not_found: "INTROUVABLE",
    status_active: "ACTIF",
    status_expired: "EXPIRÉ",
    status_paid: "PAYÉ",
    status_failed: "ÉCHOUÉ",
    status_refunded: "REMBOURSÉ",
    status_canceled: "ANNULÉ",
    status_pending: "EN ATTENTE",
    status_issued: "ÉMIS",
  },
} as const;

const STRIPE_POLL_INTERVAL_MS = 3000;
const STRIPE_POLL_MAX_ATTEMPTS = 40;

type TranslationKey = keyof typeof TRANSLATIONS.pt;

function normalizeLanguage(input: string | null | undefined): Language | null {
  if (!input) return null;
  const value = input.toLowerCase();
  if (value.startsWith("pt")) return "pt";
  if (value.startsWith("fr")) return "fr";
  if (value.startsWith("en")) return "en";
  return null;
}

function readLanguage(): Language {
  const stored = normalizeLanguage(localStorage.getItem(LANGUAGE_KEY));
  if (stored) return stored;
  const browser = normalizeLanguage(navigator.languages?.[0] ?? navigator.language);
  return browser ?? "pt";
}

function formatDateTime(iso: string | null, locale: string) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function formatPrice(amountCents: number | null, currency: string | null, locale: string) {
  if (amountCents === null || !currency) return "-";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency}`;
  }
}

function translate(lang: Language, key: TranslationKey, params?: Record<string, string>) {
  const entry = TRANSLATIONS[lang][key];
  if (typeof entry === "function") {
    return entry(params ?? {});
  }
  return entry;
}

function statusLabel(lang: Language, status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "active") return translate(lang, "status_active");
  if (normalized === "expired") return translate(lang, "status_expired");
  if (normalized === "paid") return translate(lang, "status_paid");
  if (normalized === "failed") return translate(lang, "status_failed");
  if (normalized === "refunded") return translate(lang, "status_refunded");
  if (normalized === "canceled" || normalized === "cancelled") return translate(lang, "status_canceled");
  if (normalized === "pending") return translate(lang, "status_pending");
  if (normalized === "issued") return translate(lang, "status_issued");
  return status;
}

function busyLabel(lang: Language, busy: string) {
  if (busy === "start_purchase") return translate(lang, "busy_start_purchase");
  if (busy === "check_access_status") return translate(lang, "busy_check_access_status");
  if (busy === "confirm_purchase") return translate(lang, "busy_confirm_purchase");
  if (busy === "payment_status") return translate(lang, "busy_payment_status");
  return busy;
}

function normalizeErrorMessage(e: unknown, lang: Language) {
  if (e instanceof Error) return e.message;
  return translate(lang, "unknown_error");
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

type Decision = {
  codeLast3: string;
  state: "VALID" | "EXPIRED" | "REVOKED" | "NOT_FOUND";
  serverTime: string;
  message: string;
};

function decisionLabel(lang: Language, state: Decision["state"]) {
  if (state === "VALID") return translate(lang, "decision_valid");
  if (state === "EXPIRED") return translate(lang, "decision_expired");
  if (state === "REVOKED") return translate(lang, "decision_revoked");
  return translate(lang, "decision_not_found");
}

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
  const [language, setLanguage] = useState<Language>(() => readLanguage());
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
  const [, setPurchaseHistory] = useState<PurchaseHistoryItem[]>(() => readPurchaseHistory());
  const stripePollAttemptsRef = useRef(0);

  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>(() => parseHashRoute().page ?? "b1");
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingPurchase, setPendingPurchase] = useState<PendingPurchase | null>(() => readPendingPurchase());
  const [retryAction, setRetryAction] = useState<"validate" | "start_purchase" | "confirm_purchase" | "payment_status" | null>(
    null,
  );

  const locale = LOCALE_BY_LANGUAGE[language];
  const t = (key: TranslationKey, params?: Record<string, string>) => translate(language, key, params);

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
      if (!data?.purchase) throw new Error(t("invalid_server_response"));

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
      setError(normalizeErrorMessage(e, language));
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
    localStorage.setItem(LANGUAGE_KEY, language);
  }, [language]);

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
    if (!requireOnline("validate", t("require_online_validate"))) return;
    setBusy("check_access_status");
    setError(null);
    setRetryAction(null);
    try {
      const { data, error } = await supabase.functions.invoke<CheckAccessStatusResponse>("check_access_status", {
        body: { code },
      });
      if (error) throw error;
      if (!data?.status || !data?.server_time) throw new Error(t("invalid_server_response"));

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
        message: mappedState === "VALID" ? t("access_allowed") : t("access_denied"),
      });
      setPage("b2");
      go("b2");
    } catch (e) {
      setError(normalizeErrorMessage(e, language));
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
        setError(t("pending_purchase_resume"));
      } else {
        const pending = { token: makeClientToken(), productCode: "day_pass", createdAt: new Date().toISOString() };
        writePendingPurchase(pending);
        setPendingPurchase(pending);
        setError(t("offline_queued"));
        push({ title: t("pending_purchase_title"), message: t("pending_purchase_toast") });
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
      if (!requireOnline("confirm_purchase", t("require_online_continue_payment"))) return;
      window.location.href = purchase.checkoutUrl;
      return;
    }
    if (!requireOnline("confirm_purchase", t("require_online_confirm_purchase"))) return;
    setBusy("confirm_purchase");
    setError(null);
    setRetryAction(null);
    try {
      const { data, error } = await supabase.functions.invoke<DemoPayResponse>("confirm_purchase", {
        body: { purchase_token: purchase.token },
      });
      if (error) throw error;
      if (!data?.result?.access_code || !data.result.valid_until || !data.result.purchase_id) {
        throw new Error(t("invalid_server_response"));
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
      setError(normalizeErrorMessage(e, language));
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
        setError(t("require_online_refresh_payment"));
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
      if (!data?.payment) throw new Error(t("invalid_server_response"));

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
      setError(normalizeErrorMessage(e, language));
      return null;
    } finally {
      if (manual) setBusy(null);
    }
  }

  useEffect(() => {
    if (page !== "b3_stripe" || !stripeSessionId) return;
    let active = true;
    let timeoutId: number | null = null;
    stripePollAttemptsRef.current = 0;

    const poll = async () => {
      if (!active) return;
      setStripePolling(true);
      const nextStatus = await fetchStripeStatus(false);
      setStripePolling(false);
      if (!active) return;
      if (nextStatus?.status === "pending") {
        stripePollAttemptsRef.current += 1;
        if (stripePollAttemptsRef.current >= STRIPE_POLL_MAX_ATTEMPTS) {
          setError(t("stripe_polling_stopped"));
          setRetryAction("payment_status");
          return;
        }
        timeoutId = window.setTimeout(poll, STRIPE_POLL_INTERVAL_MS);
      }
    };

    poll();
    return () => {
      active = false;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [page, stripeSessionId, language]);

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
  const savedCodesView = (
    <section className="bt-card" style={{ marginTop: 12 }}>
      <h2 className="bt-h2">{t("my_codes")}</h2>
      {savedList.length ? (
        savedList.map((item) => {
          const status = item.validUntil && new Date(item.validUntil).getTime() > Date.now() ? "ACTIVE" : "EXPIRED";
          const statusText = statusLabel(language, status);
          return (
            <div
              key={`${item.purchaseId}-${item.code}`}
              className="bt-row"
              style={{ justifyContent: "space-between", alignItems: "center", marginTop: 10 }}
            >
              <div className="bt-mono">
                {t("code_label")}: {item.code}
              </div>
              <div className="bt-mono">
                {t("valid_until_label")}: {formatDateTime(item.validUntil, locale)}
              </div>
              <StatusBadge tone={status === "ACTIVE" ? "success" : "danger"} text={statusText} />
            </div>
          );
        })
      ) : (
        <EmptyState message={t("empty_codes")} />
      )}
    </section>
  );

  return (
    <div className="bt-container">
      {busy ? <BlockingLoading label={busyLabel(language, busy)} /> : null}
      <header className="bt-header">
        <div>
          <h1 className="bt-h1">{t("title_validate_access")}</h1>
        </div>
        <div className="bt-row" style={{ gap: 8, alignItems: "center" }}>
          <span className="bt-label">{t("language_label")}</span>
          <div className="bt-row" role="group" aria-label={t("language_label")} style={{ gap: 6 }}>
            <Button
              variant={language === "pt" ? "primary" : "ghost"}
              onClick={() => setLanguage("pt")}
              aria-label={LANGUAGE_LABELS.pt}
            >
              🇵🇹
            </Button>
            <Button
              variant={language === "en" ? "primary" : "ghost"}
              onClick={() => setLanguage("en")}
              aria-label={LANGUAGE_LABELS.en}
            >
              🇬🇧
            </Button>
            <Button
              variant={language === "fr" ? "primary" : "ghost"}
              onClick={() => setLanguage("fr")}
              aria-label={LANGUAGE_LABELS.fr}
            >
              🇫🇷
            </Button>
          </div>
          <PwaNotifications language={language} />
        </div>
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
                {t("retry")}
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
                <StatusBadge tone="neutral" text={t("pending_purchase_badge")} />
                <div className="bt-mono">{t("pending_purchase_note")}</div>
              </div>
            ) : null}
            <div className="bt-row">
              <InputCode6 value={code} onChange={setCode} aria-label={t("access_code_aria")} />
              <Button variant="primary" onClick={onValidate} disabled={busy !== null}>
                {t("validate")}
              </Button>
            </div>

            <div className="bt-row" style={{ marginTop: 12 }}>
              <Button variant="ghost" onClick={onBuyStart} disabled={busy !== null}>
                {t("buy_access_one_day")}
              </Button>
            </div>
          </section>
          {savedCodesView}
        </>
      ) : null}

      {page === "b2" ? (
        <section className="bt-card">
          <h2 className="bt-h2">{t("result_title")}</h2>
          {decision ? (
            <>
              <div className="bt-row" style={{ justifyContent: "space-between" }}>
                <div className="bt-mono">
                  {t("code_label")}: {revealDecisionCode ? code : maskedDecision}
                </div>
                <StatusBadge tone={decision.state === "VALID" ? "success" : "danger"} text={decisionLabel(language, decision.state)} />
              </div>
              <div className="bt-row" style={{ marginTop: 10 }}>
                <Button
                  variant="ghost"
                  onClick={() => setRevealDecisionCode((v) => !v)}
                  disabled={busy !== null || !code}
                >
                  {revealDecisionCode ? t("mask") : t("unmask")}
                </Button>
              </div>
              <div className="bt-mono" style={{ marginTop: 10 }}>
                {decision.message}
              </div>
              <div className="bt-row" style={{ marginTop: 12 }}>
                <Button variant="ghost" onClick={onBackToValidate} disabled={busy !== null}>
                  {t("back")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <EmptyState message={t("empty_decision")} />
              <div className="bt-row" style={{ marginTop: 12 }}>
                <Button variant="ghost" onClick={onBackToValidate} disabled={busy !== null}>
                  {t("back")}
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {page === "b3_confirm" ? (
        <section className="bt-card">
          <h2 className="bt-h2">{purchase?.checkoutUrl ? t("confirm_stripe_title") : t("confirm_mock_title")}</h2>
          {purchase ? (
            <>
              <div className="bt-grid">
                <div>
                  <div className="bt-label">{t("product_label")}</div>
                  <div className="bt-mono">{t("product_day_pass")}</div>
                </div>
                <div>
                  <div className="bt-label">{t("price_label")}</div>
                  <div className="bt-mono">{formatPrice(purchase.amountCents, purchase.currency, locale)}</div>
                </div>
                <div>
                  <div className="bt-label">{t("validity_label")}</div>
                  <div className="bt-mono">{purchase.validityHours}h</div>
                </div>
              </div>
              <div className="bt-row" style={{ marginTop: 12 }}>
                <Button variant="primary" onClick={onBuyConfirm} disabled={busy !== null}>
                  {purchase.checkoutUrl ? t("go_to_payment") : t("confirm")}
                </Button>
                <Button variant="ghost" onClick={onBuyClose} disabled={busy !== null}>
                  {t("back")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <EmptyState message={t("empty_purchase", { cta: t("buy_access_one_day") })} />
              <div className="bt-row" style={{ marginTop: 12 }}>
                <Button variant="ghost" onClick={onBuyClose} disabled={busy !== null}>
                  {t("back")}
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {page === "b3_stripe" ? (
        <section className="bt-card">
          <h2 className="bt-h2">{t("payment_status_title")}</h2>
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
                  text={statusLabel(language, stripeStatus?.status ?? "pending")}
                />
              </div>
              <div className="bt-mono" style={{ marginTop: 10 }}>
                {stripePolling ? t("updating") : null}
              </div>
              <div className="bt-row" style={{ marginTop: 12 }}>
                <Button variant="ghost" onClick={() => fetchStripeStatus(true)} disabled={busy !== null}>
                  {t("refresh")}
                </Button>
                <Button variant="ghost" onClick={onBuyClose} disabled={busy !== null}>
                  {t("back")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <EmptyState message={t("empty_stripe_session")} />
              <div className="bt-row" style={{ marginTop: 12 }}>
                <Button variant="ghost" onClick={onBuyClose} disabled={busy !== null}>
                  {t("back")}
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {page === "b3_code" ? (
        <section className="bt-card">
          <h2 className="bt-h2">{t("issued_code_title")}</h2>
          {issued ? (
            <>
              <div className="bt-row" style={{ justifyContent: "space-between" }}>
                <div className="bt-mono">
                  {t("code_label")}: {revealIssuedCode ? fullIssued : maskedIssued}
                </div>
                <StatusBadge tone="success" text={statusLabel(language, "issued")} />
              </div>
              <div className="bt-row" style={{ marginTop: 10 }}>
                <Button
                  variant="ghost"
                  onClick={() => setRevealIssuedCode((v) => !v)}
                  disabled={busy !== null || !issued}
                >
                  {revealIssuedCode ? t("mask") : t("unmask")}
                </Button>
              </div>
              <div className="bt-mono" style={{ marginTop: 10 }}>
                {t("valid_until_text", { date: formatDateTime(issued.validUntil, locale) })}
              </div>
              <div className="bt-mono" style={{ marginTop: 10 }}>
                {t("issued_notice")}
              </div>
              <div className="bt-row" style={{ marginTop: 12 }}>
                <Button variant="ghost" onClick={onBuyClose} disabled={busy !== null}>
                  {t("back")}
                </Button>
              </div>
              {savedCodesView}
            </>
          ) : (
            <>
              <EmptyState message={t("empty_code")} />
              <div className="bt-row" style={{ marginTop: 12 }}>
                <Button variant="ghost" onClick={onBuyClose} disabled={busy !== null}>
                  {t("back")}
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
