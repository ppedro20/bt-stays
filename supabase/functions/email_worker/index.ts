import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { logError, logInfo } from "../_shared/log.ts";

type StripeEvent = {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
};

type JobRow = {
  job_id: string;
  event_type: string;
  attempts: number;
  max_attempts: number;
};

const BATCH_SIZE = 10;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function computeNextAttemptAt(attempts: number): string {
  const exp = Math.min(attempts, 10);
  const base = Math.min(BASE_BACKOFF_MS * 2 ** exp, MAX_BACKOFF_MS);
  const jitter = base * (0.1 + Math.random() * 0.2);
  return new Date(Date.now() + base + jitter).toISOString();
}

function isDataError(message: string): boolean {
  return (
    message.startsWith("data:") ||
    message === "payment_not_found" ||
    message === "access_code_missing" ||
    message === "code_not_found" ||
    message === "missing_email_or_payment_id"
  );
}

function toText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getNested(obj: Record<string, unknown>, path: string[]): unknown {
  return path.reduce((acc, key) => {
    if (!acc || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj as unknown);
}

function extractEmailAndIds(event: StripeEvent) {
  const obj = (event.data?.object ?? {}) as Record<string, unknown>;
  const payerEmail =
    toText(getNested(obj, ["customer_details", "email"])) ??
    toText(obj.customer_email) ??
    toText(obj.receipt_email) ??
    toText(getNested(obj, ["customer", "email"])) ??
    toText(getNested(obj, ["charges", "data", "0", "billing_details", "email"])) ??
    toText(getNested(obj, ["charges", "data", "0", "receipt_email"]));

  const objectId = toText(obj.id);
  const paymentIntent = toText(obj.payment_intent);
  const providerPaymentId = objectId ?? paymentIntent;

  const receiptUrl =
    toText(obj.receipt_url) ?? toText(getNested(obj, ["charges", "data", "0", "receipt_url"]));

  return { payerEmail, providerPaymentId, receiptUrl };
}

async function fetchStripeEvent(eventId: string, stripeSecret: string): Promise<StripeEvent> {
  const res = await fetch(`https://api.stripe.com/v1/events/${eventId}`, {
    headers: { Authorization: `Bearer ${stripeSecret}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`stripe_event_fetch_failed:${res.status}:${body}`);
  }
  return res.json();
}

async function sendResendEmail(
  apiKey: string,
  from: string,
  to: string,
  code: string,
  validUntil: string,
  receiptUrl: string | null,
) {
  const subject = "Codigo de acesso";
  const receiptLine = receiptUrl ? `Recibo: ${receiptUrl}` : "";
  const text = [
    "O seu codigo de acesso:",
    code,
    `Valido ate: ${validUntil}`,
    receiptLine,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
  const htmlReceipt = receiptUrl ? `<p>Recibo: <a href="${receiptUrl}">${receiptUrl}</a></p>` : "";
  const html = `<p>O seu codigo de acesso:</p><p><strong>${code}</strong></p><p>Valido ate: ${validUntil}</p>${htmlReceipt}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text, html }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`resend_failed:${res.status}:${body}`);
  }
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  if (req.method !== "POST") {
    logInfo("email_worker", "method_not_allowed", { requestId, method: req.method });
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405 });
  }

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const resendFrom = Deno.env.get("RESEND_FROM");

  if (!stripeSecret || !resendApiKey || !resendFrom) {
    logError("email_worker", "not_configured", { requestId });
    return new Response(JSON.stringify({ error: "not_configured" }), { status: 501 });
  }

  const { data: jobs, error } = await supabaseAdmin
    .from("email_jobs")
    .select("job_id, event_type, attempts, max_attempts")
    .eq("status", "pending")
    .lte("next_attempt_at", nowIso())
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    logError("email_worker", "fetch_jobs_failed", { requestId, err: error.message });
    return new Response(JSON.stringify({ error: "fetch_jobs_failed" }), { status: 500 });
  }

  for (const job of jobs ?? []) {
    const jobId = job.job_id;
    const claimAt = nowIso();
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from("email_jobs")
      .update({ status: "processing", updated_at: claimAt })
      .eq("job_id", jobId)
      .eq("status", "pending")
      .select("job_id");

    if (claimError || !claimed || claimed.length === 0) {
      if (claimError) {
        logError("email_worker", "claim_failed", { requestId, jobId, err: claimError.message });
      }
      continue;
    }

    try {
      const stripeEvent = await fetchStripeEvent(jobId, stripeSecret);
      const { payerEmail, providerPaymentId, receiptUrl } = extractEmailAndIds(stripeEvent);

      if (!payerEmail || !providerPaymentId) {
        throw new Error("data:missing_email_or_payment_id");
      }

      const { data: payment, error: paymentError } = await supabaseAdmin
        .from("payments")
        .select("id, access_code_id")
        .eq("provider", "stripe")
        .or(`provider_payment_id.eq.${providerPaymentId},provider_checkout_session_id.eq.${providerPaymentId}`)
        .maybeSingle();

      if (paymentError || !payment) {
        throw new Error("data:payment_not_found");
      }

      const codeId = payment.access_code_id;
      if (!codeId) {
        throw new Error("data:access_code_missing");
      }

      const { data: codeRow, error: codeError } = await supabaseAdmin
        .from("access_codes")
        .select("code_plaintext, valid_until")
        .eq("id", codeId)
        .maybeSingle();

      if (codeError || !codeRow?.code_plaintext) {
        throw new Error("data:code_not_found");
      }

      await sendResendEmail(
        resendApiKey,
        resendFrom,
        payerEmail,
        codeRow.code_plaintext,
        codeRow.valid_until,
        receiptUrl,
      );

      await supabaseAdmin
        .from("email_jobs")
        .update({ status: "completed", updated_at: nowIso() })
        .eq("job_id", jobId);

      await supabaseAdmin.from("email_events").insert({
        event_id: jobId,
        payment_id: payment.id,
        email: payerEmail,
        status: "email_sent",
      });

      logInfo("email_worker", "job_completed", {
        requestId,
        jobId,
        eventType: job.event_type,
        paymentId: payment.id,
        email: payerEmail,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const nextAttempts = job.attempts + 1;
      const dataError = isDataError(message);
      const exceeded = nextAttempts >= job.max_attempts;

      if (dataError || exceeded) {
        await supabaseAdmin.from("email_events").insert({
          event_id: job.job_id,
          payment_id: null,
          email: null,
          status: "email_failed",
          error: message,
        });
        await supabaseAdmin.from("email_jobs_dlq").insert({
          job_id: job.job_id,
          event_type: job.event_type,
          attempts: nextAttempts,
          max_attempts: job.max_attempts,
          last_error: message,
        });
        await supabaseAdmin.from("email_jobs").delete().eq("job_id", jobId);
      } else {
        await supabaseAdmin
          .from("email_jobs")
          .update({
            status: "pending",
            attempts: nextAttempts,
            next_attempt_at: computeNextAttemptAt(nextAttempts),
            updated_at: nowIso(),
          })
          .eq("job_id", jobId);
      }

      logError("email_worker", "job_failed", {
        requestId,
        jobId,
        err: message,
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: jobs?.length ?? 0 }), { status: 200 });
});
