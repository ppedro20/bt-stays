import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { rateLimit } from "../_shared/rateLimit.ts";
import { logError, logInfo } from "../_shared/log.ts";

type Body = { product_code?: string; client_token?: string };

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
      logInfo("start_purchase", "method_not_allowed", { requestId, method: req.method });
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ip = getClientIp(req);
    const rl = rateLimit(`start_purchase:${ip}`, 10, 60_000);
    if (!rl.ok) {
      logInfo("start_purchase", "rate_limited", { requestId, ip });
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
      logInfo("start_purchase", "invalid_json", { requestId, ip });
      return new Response(JSON.stringify({ error: "invalid_json" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabaseAdmin.rpc("create_payment", {
      p_product_code: body.product_code ?? "day_pass",
      p_payment_token: body.client_token ?? null,
    });

    if (error) {
      logError("start_purchase", "create_payment_failed", { requestId, err: error.message });
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const row = data?.[0];
    if (!row) {
      logError("start_purchase", "empty_result", { requestId });
      return new Response(JSON.stringify({ error: "empty_result" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const providerEnv = Deno.env.get("PAYMENTS_PROVIDER")?.trim().toLowerCase();
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const provider = providerEnv ?? (stripeKey ? "stripe" : "mock");

    if (provider === "stripe") {
      if (!stripeKey) {
        logError("start_purchase", "stripe_not_configured", { requestId });
        return new Response(JSON.stringify({ error: "stripe_not_configured" }), {
          status: 501,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const amountCents = Number(Deno.env.get("PAYMENTS_DAY_PASS_AMOUNT_CENTS") ?? row.amount_cents);
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        logError("start_purchase", "invalid_amount_config", { requestId, amountCents });
        return new Response(JSON.stringify({ error: "invalid_amount_config" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const currency = (Deno.env.get("PAYMENTS_CURRENCY") ?? row.currency ?? "EUR").toUpperCase();
      const stripeCurrency = currency.toLowerCase();

      const successUrl = Deno.env.get("STRIPE_SUCCESS_URL");
      const cancelUrl = Deno.env.get("STRIPE_CANCEL_URL");
      if (!successUrl || !cancelUrl) {
        logError("start_purchase", "stripe_urls_not_configured", { requestId });
        return new Response(JSON.stringify({ error: "stripe_urls_not_configured" }), {
          status: 501,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const params = new URLSearchParams();
      params.set("mode", "payment");
      params.set("success_url", successUrl);
      params.set("cancel_url", cancelUrl);
      params.set("client_reference_id", row.payment_id);
      params.set("metadata[payment_id]", row.payment_id);
      params.set("payment_intent_data[metadata][payment_id]", row.payment_id);
      params.set("line_items[0][price_data][currency]", stripeCurrency);
      params.set("line_items[0][price_data][unit_amount]", String(amountCents));
      params.set("line_items[0][price_data][product_data][name]", "Acesso 1 dia");
      params.set("line_items[0][quantity]", "1");

      const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      if (!stripeRes.ok) {
        const err = await stripeRes.text();
        logError("start_purchase", "stripe_session_failed", { requestId, status: stripeRes.status, err });
        return new Response(JSON.stringify({ error: "stripe_session_failed", detail: err }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const session = (await stripeRes.json()) as { id: string; url?: string; status?: string; payment_intent?: string };
      if (!session.id || !session.url) {
        logError("start_purchase", "stripe_session_invalid", { requestId, sessionId: session.id ?? null });
        return new Response(JSON.stringify({ error: "stripe_session_invalid" }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const providerPaymentId = session.payment_intent ?? session.id;

      const { error: updateError } = await supabaseAdmin
        .from("payments")
        .update({
          status: "pending",
          amount_cents: amountCents,
          currency,
          provider: "stripe",
          provider_payment_id: providerPaymentId,
          provider_checkout_session_id: session.id,
          provider_status: session.status ?? "open",
          provider_payload: {
            checkout_url: session.url,
            payment_intent: session.payment_intent ?? null,
            checkout_session_id: session.id,
          },
        })
        .eq("id", row.payment_id);

      if (updateError) {
        logError("start_purchase", "payment_update_failed", { requestId, err: updateError.message });
        return new Response(JSON.stringify({ error: updateError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabaseAdmin.from("events").insert({
        event_type: "payment_provider_attached",
        entity_type: "payment",
        entity_id: row.payment_id,
        actor_type: "system",
        details: { provider: "stripe", provider_payment_id: session.id },
      });

      logInfo("start_purchase", "stripe_session_created", {
        requestId,
        paymentId: row.payment_id,
        providerPaymentId,
      });

      return new Response(
        JSON.stringify({
          ok: true,
          purchase: {
            purchase_id: row.payment_id,
            purchase_token: row.payment_token,
            amount_cents: amountCents,
            currency,
            validity_hours: row.validity_hours,
            provider: "stripe",
            checkout_url: session.url,
          },
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    logInfo("start_purchase", "mock_purchase_created", { requestId, paymentId: row.payment_id });

    return new Response(
      JSON.stringify({
        ok: true,
        purchase: {
          purchase_id: row.payment_id,
          purchase_token: row.payment_token,
          amount_cents: row.amount_cents,
          currency: row.currency,
          validity_hours: row.validity_hours,
          provider: "mock",
          checkout_url: null,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    logError("start_purchase", "unhandled_error", { err: e instanceof Error ? e.message : String(e) });
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
