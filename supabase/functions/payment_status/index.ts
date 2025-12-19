import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { rateLimit } from "../_shared/rateLimit.ts";
import { logError, logInfo } from "../_shared/log.ts";

type Body = { provider_payment_id?: string };

function getClientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? "unknown";
  return "unknown";
}

Deno.serve(async (req) => {
  try {
    const requestId = crypto.randomUUID();
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") {
      logInfo("payment_status", "method_not_allowed", { requestId, method: req.method });
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ip = getClientIp(req);
    const rl = rateLimit(`payment_status:${ip}`, 10, 30_000);
    if (!rl.ok) {
      logInfo("payment_status", "rate_limited", { requestId, ip });
      return new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
        },
      });
    }

    let body: Body;
    try {
      body = await req.json();
    } catch {
      logInfo("payment_status", "invalid_json", { requestId, ip });
      return new Response(JSON.stringify({ error: "invalid_json" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const providerPaymentId = body.provider_payment_id?.trim();
    if (!providerPaymentId) {
      logInfo("payment_status", "missing_provider_payment_id", { requestId, ip });
      return new Response(JSON.stringify({ error: "missing_provider_payment_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payment = await supabaseAdmin
      .from("payments")
      .select("id,status,access_code_id")
      .eq("provider", "stripe")
      .or(`provider_checkout_session_id.eq.${providerPaymentId},provider_payment_id.eq.${providerPaymentId}`)
      .maybeSingle();

    if (payment.error) {
      logError("payment_status", "payment_query_failed", { requestId, err: payment.error.message });
      return new Response(JSON.stringify({ error: payment.error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!payment.data) {
      logInfo("payment_status", "payment_not_found", { requestId, providerPaymentId });
      return new Response(JSON.stringify({ error: "payment_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accessCode: { code_plaintext: string | null; valid_until: string | null } | null = null;
    if (payment.data.status === "paid" && payment.data.access_code_id) {
      const codeRes = await supabaseAdmin
        .from("access_codes")
        .select("code_plaintext,valid_until")
        .eq("id", payment.data.access_code_id)
        .maybeSingle();
      if (codeRes.error) {
        logError("payment_status", "access_code_query_failed", { requestId, err: codeRes.error.message });
        return new Response(JSON.stringify({ error: codeRes.error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      accessCode = codeRes.data ?? null;
    }

    logInfo("payment_status", "status_ok", {
      requestId,
      paymentId: payment.data.id,
      status: payment.data.status,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        payment: {
          purchase_id: payment.data.id,
          status: payment.data.status,
          access_code: accessCode?.code_plaintext ?? null,
          valid_until: accessCode?.valid_until ?? null,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    logError("payment_status", "unhandled_error", { err: e instanceof Error ? e.message : String(e) });
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
